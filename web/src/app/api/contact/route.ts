import { getAdminClient } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  try {
    const { name, email, message } = await request.json();

    if (!name?.trim() || !email?.trim() || !message?.trim()) {
      return Response.json({ error: "All fields are required" }, { status: 400 });
    }

    const admin = getAdminClient();
    const { error } = await admin.from("contact_messages").insert({
      name: name.trim(),
      email: email.trim(),
      message: message.trim(),
    });

    if (error) {
      console.error("Contact message save error:", error);
      return Response.json({ error: "Failed to save message" }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (e) {
    console.error("Contact API error:", e);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
