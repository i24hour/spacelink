# SpaceLink Screen Capture and Productivity Check

## Goal

Add an Android feature that lets a user voluntarily monitor their phone. While monitoring is active, SpaceLink captures approximately one screenshot per hour, sends it to the API for vision analysis, and delivers a short productivity check through the user's connected Telegram account.

The first release is an Android APK for personal testing. It will not require Play Store publication.

## Important Product Rules

- Monitoring starts only after the user explicitly taps **Start monitoring**.
- Android screen-capture permission must be requested and clearly explained.
- A visible Android foreground-service notification must show while monitoring is active.
- Capture only while the phone is unlocked and the monitoring session is active.
- The user can pause or stop monitoring at any time.
- Screenshots are temporary inputs. They should not be retained after analysis unless the user explicitly enables history.
- The system should say that activity "appears productive" or "appears off-track", not make absolute or insulting judgments.
- The user supplies context, for example: "I am preparing for an exam."
- Sensitive content should not be described in Telegram messages.
- Telegram notifications must be rate-limited so the bot cannot spam the user.

## Proposed Architecture

```text
Android APK
  -> Kotlin foreground service
  -> Android MediaProjection screenshot
  -> authenticated multipart upload
  -> SpaceLink API on Render
  -> vision LLM analysis
  -> temporary result storage
  -> existing Telegram notification service
```

The Android app will not call the LLM directly. The existing API remains responsible for authentication, model calls, privacy controls, persistence, and Telegram delivery.

## Repository Changes

### New folder

Create a new native Android project:

```text
apps/android/
  settings.gradle.kts
  build.gradle.kts
  gradle.properties
  app/
    build.gradle.kts
    proguard-rules.pro
    src/main/AndroidManifest.xml
    src/main/java/.../MainActivity.kt
    src/main/java/.../ScreenCaptureService.kt
    src/main/java/.../CaptureScheduler.kt
    src/main/java/.../ApiClient.kt
    src/main/java/.../AuthStore.kt
    src/main/java/.../MonitoringState.kt
    src/main/res/...
```

The package name and application ID will be chosen once before implementation and kept stable for APK upgrades.

### Existing files expected to change

#### Database

- `packages/db/prisma/schema.prisma`
  - Add monitoring-session data.
  - Add screen-check result data.
  - Store analysis metadata and timestamps, not raw screenshots by default.
- `packages/db/prisma/migrations/...`
  - Add the database migration for the new models.
  - The repository currently ignores this directory, so migration tracking/deployment must be handled deliberately before production use.

#### API

- `apps/api/src/index.ts`
  - Mount the new mobile monitoring routes.
- `apps/api/src/routes/mobile-monitoring.ts`
  - Add authenticated start, stop, status, and screenshot-analysis endpoints.
- `apps/api/src/services/screen-analysis.ts`
  - Validate the uploaded image.
  - Call the existing vision LLM helper.
  - Enforce a strict structured response schema.
  - Remove temporary image data after analysis.
- `apps/api/src/services/monitoring-notifications.ts`
  - Convert analysis results into concise Telegram messages.
  - Apply confidence thresholds, quiet hours, and duplicate-message protection.
- `apps/api/src/lib/mobile-auth.ts` or the existing auth modules
  - Reuse the existing user identity while adding a revocable device/session token for the Android app.
- `apps/api/src/services/notifications/telegram.ts`
  - Extend only if the existing Telegram sender needs a small helper for monitoring messages.

#### Web dashboard

- `apps/web/src/app/settings/page.tsx`
  - Add monitoring status, goal/context, pause controls, and privacy settings.
- `apps/web/src/lib/api-client.ts`
  - Add typed calls if the dashboard manages monitoring settings.
- Add a small dedicated settings component only if the existing settings page becomes too large.

#### Configuration

- `apps/api/.env.example` and `apps/web/.env.example` only if new non-secret configuration is required.
- Never commit API keys, Telegram tokens, LLM keys, device secrets, or raw screenshots.

## Implementation Phases

### Phase 1: Confirm the contract

- Confirm Android-only scope.
- Confirm hourly cadence and whether a few minutes of Android scheduling drift is acceptable.
- Define supported Android versions.
- Define whether results are sent every hour or only when the activity appears off-track.
- Define quiet hours and low-battery behavior.

### Phase 2: Add database and API foundations

- Add Prisma models for monitoring sessions and screen checks.
- Add authenticated mobile session creation/revocation.
- Add upload size/type validation and rate limiting.
- Add an API health/status response for the Android app.
- Add tests for authentication, ownership, rate limits, and malformed uploads.

### Phase 3: Build the Android MVP

- Create the Kotlin Android app.
- Implement sign-in/device pairing using the existing SpaceLink account.
- Implement Start/Stop/Pause controls.
- Request MediaProjection permission.
- Run the visible foreground service.
- Capture and compress one screenshot.
- Upload it to the API.
- Display the last successful check and error state.

### Phase 4: Add vision analysis

Return structured analysis similar to:

```json
{
  "classification": "productive",
  "confidence": 0.86,
  "observed_activity": "Reading exam preparation material",
  "reason": "The visible activity matches the user's stated goal",
  "suggestion": "Continue this focus block",
  "sensitive_content": false
}
```

Allowed classifications:

- `productive`
- `off_track`
- `unclear`
- `sensitive_content`

The LLM prompt will include the user's goal, current time, and recent check context. Low-confidence or sensitive results will produce a neutral message or no message.

### Phase 5: Telegram integration

Add monitoring commands and messages:

- `/monitor status`
- `/monitor pause`
- `/monitor resume`
- `/monitor stop`
- `/monitor goal`

Use the existing Telegram identity and sender. Add notification deduplication and a cooldown so one screenshot produces at most one user-facing result.

### Phase 6: Dashboard and privacy controls

Add controls for:

- Monitoring enabled/paused/stopped.
- Current goal.
- Notification preference.
- Quiet hours.
- Low-battery behavior.
- Screenshot retention, defaulting to no retention.
- Delete analysis history.

The dashboard should show analysis summaries and timestamps, not raw screenshots by default.

### Phase 7: Testing

Test the following before deployment:

- Permission granted and permission denied.
- Permission revoked during monitoring.
- Phone locked or screen turned off.
- App process killed.
- No network connection.
- API timeout and LLM failure.
- Telegram disconnected.
- Low battery and battery-saver mode.
- Duplicate hourly uploads.
- Oversized or invalid images.
- Sensitive-content handling.
- User can revoke the device/session token.

### Phase 8: APK rollout

1. Build a debug APK.
2. Install it directly on the test phone.
3. Connect it to the local API or a controlled Render environment.
4. Test one manual capture first.
5. Test the hourly flow.
6. Build a signed release APK after the workflow is stable.
7. Consider Play Store publication later using an Android App Bundle.

## First MVP Acceptance Criteria

The first implementation is successful when:

- The user can sign in or pair the Android app with an existing SpaceLink account.
- The user can start and stop monitoring.
- Android clearly shows that screen capture is active.
- One screenshot can be captured and uploaded securely.
- The API returns a valid structured analysis.
- Telegram receives one useful message.
- The screenshot is deleted after processing.
- Permission, network, API, and Telegram failures are visible and recoverable.
- No existing deadline tracking or Telegram authentication behavior regresses.

## Deliberate Non-Goals for the First Version

- iPhone support.
- Invisible screen capture.
- Continuous video recording.
- Automatic monitoring after device reboot.
- Storing a permanent screenshot timeline.
- Sending screenshots directly from the Android app to the LLM provider.
- Publishing to the Play Store.
