import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "../scripts/load-local-env.mjs";

loadLocalEnv();

const supabaseUrl = process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const demoUsers = [
  {
    role: "admin",
    email: process.env.DEMO_ADMIN_EMAIL,
    password: process.env.DEMO_ADMIN_PASSWORD,
    displayName: "Demo Admin",
  },
  {
    role: "editor",
    email: process.env.DEMO_EDITOR_EMAIL,
    password: process.env.DEMO_EDITOR_PASSWORD,
    displayName: "Demo Editor",
  },
  {
    role: "viewer",
    email: process.env.DEMO_VIEWER_EMAIL,
    password: process.env.DEMO_VIEWER_PASSWORD,
    displayName: "Demo Viewer",
  },
];

function assert(value, message) {
  if (!value) throw new Error(message);
  return value;
}

async function findUserByEmail(supabase, email) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;

    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
    if (user) return user;
    if (data.users.length < 100) return null;
  }

  throw new Error("User lookup exceeded 2000 users; narrow the script for this project before continuing.");
}

async function upsertAuthUser(supabase, user) {
  const existing = await findUserByEmail(supabase, user.email);
  if (existing) {
    const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
      email: user.email,
      password: user.password,
      email_confirm: true,
      user_metadata: {
        display_name: user.displayName,
        demo_role: user.role,
      },
    });
    if (error) throw error;
    return data.user;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: {
      display_name: user.displayName,
      demo_role: user.role,
    },
  });
  if (error) throw error;
  return data.user;
}

async function getOrCreateDemoFamily(supabase, adminUserId) {
  const familyName = process.env.DEMO_FAMILY_NAME || "Demo Family";
  const { data: existingFamilies, error: lookupError } = await supabase
    .from("families")
    .select("id")
    .eq("name", familyName)
    .limit(1);
  if (lookupError) throw lookupError;

  const existing = existingFamilies?.[0];
  if (existing?.id) return existing.id;

  const { data, error } = await supabase
    .from("families")
    .insert({
      name: familyName,
      base_currency: "RUB",
      created_by: adminUserId,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function seedDomainData(supabase, familyId, adminUserId) {
  const { data: portfolio, error: portfolioError } = await supabase
    .from("portfolios")
    .upsert(
      {
        family_id: familyId,
        name: "Demo Portfolio",
        base_currency: "RUB",
        description: "Portfolio for stage 2 browser demo.",
        created_by: adminUserId,
        updated_by: adminUserId,
      },
      { onConflict: "family_id,name" },
    )
    .select("id")
    .single();
  if (portfolioError) throw portfolioError;

  const { error: accountError } = await supabase.from("accounts").upsert(
    {
      family_id: familyId,
      portfolio_id: portfolio.id,
      account_type_code: "brokerage",
      name: "Demo Broker Account",
      institution_name: "Demo Broker",
      currency_code: "RUB",
      status: "active",
      created_by: adminUserId,
      updated_by: adminUserId,
    },
    { onConflict: "family_id,portfolio_id,name" },
  );
  if (accountError) throw accountError;

  await supabase.from("audit_log").insert({
    family_id: familyId,
    actor_user_id: adminUserId,
    action: "seed_demo_users",
    entity_table: "family_members",
    after_data: {
      roles: demoUsers.map(({ email, role }) => ({ email, role })),
      portfolio: "Demo Portfolio",
      account: "Demo Broker Account",
    },
  });
}

async function main() {
  assert(supabaseUrl, "Missing SUPABASE_INTERNAL_URL or NEXT_PUBLIC_SUPABASE_URL");
  assert(serviceRoleKey, "Missing SUPABASE_SERVICE_ROLE_KEY");

  for (const user of demoUsers) {
    assert(user.email, `Missing DEMO_${user.role.toUpperCase()}_EMAIL`);
    assert(user.password, `Missing DEMO_${user.role.toUpperCase()}_PASSWORD`);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const users = new Map();
  for (const demoUser of demoUsers) {
    const authUser = await upsertAuthUser(supabase, demoUser);
    users.set(demoUser.role, authUser);

    const { error: profileError } = await supabase.from("profiles").upsert({
      user_id: authUser.id,
      display_name: demoUser.displayName,
    });
    if (profileError) throw profileError;
  }

  const adminUser = users.get("admin");
  const familyId = await getOrCreateDemoFamily(supabase, adminUser.id);

  for (const demoUser of demoUsers) {
    const authUser = users.get(demoUser.role);
    const { error } = await supabase.from("family_members").upsert({
      family_id: familyId,
      user_id: authUser.id,
      role: demoUser.role,
      created_by: adminUser.id,
    });
    if (error) throw error;
  }

  await seedDomainData(supabase, familyId, adminUser.id);

  console.log("Demo users seeded.");
  console.log(`Family: ${familyId}`);
  for (const demoUser of demoUsers) {
    console.log(`${demoUser.role}: ${demoUser.email}`);
  }
}

main().catch((error) => {
  console.error("Demo user seed failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
