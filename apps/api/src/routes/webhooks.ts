import { Router, raw } from "express";
import { Webhook } from "svix";
import { prisma } from "../lib/prisma";

const router = Router();

router.post("/clerk", raw({ type: "application/json" }), async (req, res) => {
  const payload = req.body;
  const headers = req.headers;

  const wh = new Webhook(process.env.CLERK_WEBHOOK_SECRET || "");
  let evt: any;
  try {
    evt = wh.verify(payload, headers as any);
  } catch (err) {
    return res.status(400).json({ error: "Invalid webhook signature" });
  }

  const { id, email_addresses, primary_email_address_id } = evt.data;
  const email = email_addresses?.find(
    (e: any) => e.id === primary_email_address_id
  )?.email_address;

  if (evt.type === "user.created") {
    await prisma.user.upsert({
      where: { id },
      create: { id, email: email || "" },
      update: { email: email || "" },
    });
  } else if (evt.type === "user.updated") {
    await prisma.user.update({
      where: { id },
      data: { email: email || "" },
    });
  } else if (evt.type === "user.deleted") {
    await prisma.user.delete({ where: { id } }).catch(() => {});
  }

  return res.json({ ok: true });
});

export default router;
