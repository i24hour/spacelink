import * as esbuild from "esbuild";
import * as fs from "fs";
import * as path from "path";

const outDir = "build/chrome-mv3-prod";

async function build() {
  fs.mkdirSync(outDir, { recursive: true });

  // Bundle popup
  await esbuild.build({
    entryPoints: ["src/popup.tsx"],
    bundle: true,
    outfile: path.join(outDir, "popup.js"),
    format: "iife",
    target: ["chrome105"],
    jsx: "automatic",
    define: { "process.env.PLASMO_PUBLIC_API_URL": '"https://deadlineai-api.onrender.com"' },
    loader: { ".css": "css" },
    minify: true,
  });

  // Bundle background
  await esbuild.build({
    entryPoints: ["src/background.ts"],
    bundle: true,
    outfile: path.join(outDir, "background.js"),
    format: "iife",
    target: ["chrome105"],
    minify: true,
  });

  // Bundle content script
  await esbuild.build({
    entryPoints: ["src/content.ts"],
    bundle: true,
    outfile: path.join(outDir, "content.js"),
    format: "iife",
    target: ["chrome105"],
    minify: true,
  });

  // Write popup.html
  fs.writeFileSync(
    path.join(outDir, "popup.html"),
    `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>DeadlineAI</title>
<link rel="stylesheet" href="popup.css" />
</head>
<body>
<div id="root"></div>
<script src="popup.js"></script>
</body>
</html>`
  );

  // Copy manifest.json and adjust paths
  const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf-8"));
  manifest.background = { service_worker: "background.js" };
  manifest.content_scripts[0].js = ["content.js"];
  manifest.action.default_popup = "popup.html";
  manifest.action.default_icon = {
    16: "assets/icon16.png",
    32: "assets/icon32.png",
    48: "assets/icon48.png",
    128: "assets/icon128.png"
  };
  manifest.icons = {
    16: "assets/icon16.png",
    32: "assets/icon32.png",
    48: "assets/icon48.png",
    128: "assets/icon128.png"
  };
  manifest.web_accessible_resources[0].resources = ["assets/*"];
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  // Copy assets
  const copyDir = (src, dest) => {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) copyDir(srcPath, destPath);
      else fs.copyFileSync(srcPath, destPath);
    }
  };
  if (fs.existsSync("src/assets")) copyDir("src/assets", path.join(outDir, "assets"));
  if (fs.existsSync("assets")) copyDir("assets", path.join(outDir, "assets"));

  console.log("✅ Extension built to", outDir);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
