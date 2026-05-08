const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const WHATSAPP_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || "";

export async function sendWhatsApp(to: string, text: string) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) {
    console.warn("WhatsApp credentials missing");
    return { delivered: false, error: "No credentials" };
  }
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          text: { body: text },
        }),
      }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(data));
    return { delivered: true, data };
  } catch (err: any) {
    return { delivered: false, error: err?.message || String(err) };
  }
}
