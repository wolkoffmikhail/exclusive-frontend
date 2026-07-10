"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActiveFamily } from "@/lib/portfolio/data";
import { createClient } from "@/lib/supabase/server";

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

const allowedMimeTypes = new Set([
  "application/pdf",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const allowedExtensions = new Set(["pdf", "csv", "xls", "xlsx"]);

function cleanFileName(name: string) {
  return (
    name
      .normalize("NFKD")
      .replace(/[^\w.\-а-яА-ЯёЁ]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 180) || "broker-report"
  );
}

function fileExtension(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  return extension && extension !== name.toLowerCase() ? extension : "";
}

function redirectWithError(code: string): never {
  redirect(`/import?error=${encodeURIComponent(code)}`);
}

export async function uploadBrokerReport(formData: FormData) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/login");

  const family = await getActiveFamily(supabase, userId);
  if (!family) redirectWithError("no-family");
  if (family.role === "viewer") redirectWithError("forbidden");

  const accountId = String(formData.get("account_id") ?? "");
  if (!accountId) redirectWithError("account-required");

  const file = formData.get("report");
  if (!(file instanceof File) || file.size === 0) redirectWithError("file-required");
  if (file.size > MAX_FILE_SIZE_BYTES) redirectWithError("file-too-large");

  const extension = fileExtension(file.name);
  const mimeAllowed = file.type ? allowedMimeTypes.has(file.type) : false;
  if (!mimeAllowed && !allowedExtensions.has(extension)) redirectWithError("file-type");

  const { data: account } = await supabase
    .from("accounts")
    .select("id, family_id, portfolio_id")
    .eq("family_id", family.id)
    .eq("id", accountId)
    .maybeSingle();

  if (!account) redirectWithError("account-not-found");

  const bytes = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const { data: existingImport } = await supabase
    .from("imports")
    .select("id")
    .eq("family_id", family.id)
    .eq("account_id", account.id)
    .eq("sha256", sha256)
    .maybeSingle();

  if (existingImport) redirectWithError("duplicate");

  const importId = crypto.randomUUID();
  const safeName = cleanFileName(file.name);
  const objectKey = `families/${family.id}/imports/${importId}/${safeName}`;
  const contentType = file.type || "application/octet-stream";

  const { error: uploadError } = await supabase.storage
    .from("broker-reports")
    .upload(objectKey, bytes, {
      contentType,
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  const { error: insertError } = await supabase.from("imports").insert({
    id: importId,
    family_id: family.id,
    portfolio_id: account.portfolio_id,
    account_id: account.id,
    original_file_name: file.name,
    storage_bucket: "broker-reports",
    storage_object_key: objectKey,
    file_mime_type: contentType,
    file_size_bytes: file.size,
    sha256,
    status: "uploaded",
    imported_by: userId,
  });

  if (insertError) {
    throw new Error(`Import record creation failed: ${insertError.message}`);
  }

  await supabase.from("audit_log").insert({
    family_id: family.id,
    actor_user_id: userId,
    action: "upload_broker_report",
    entity_table: "imports",
    entity_id: importId,
    after_data: {
      original_file_name: file.name,
      storage_object_key: objectKey,
      file_size_bytes: file.size,
      sha256,
    },
  });

  revalidatePath("/import");
  redirect("/import?uploaded=1");
}
