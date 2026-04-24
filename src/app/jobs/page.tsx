import Link from "next/link";
import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "@/lib/supabase/server";

function readString(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function toNullableText(value: string) {
  return value.length > 0 ? value : null;
}

function buildAddressLabel(parts: string[]) {
  const value = parts.filter(Boolean).join(", ");
  return value.length > 0 ? value : null;
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function createJobAction(formData: FormData) {
  "use server";

  const name = readString(formData.get("name"));
  if (!name) {
    redirect(`/jobs?message=${encodeURIComponent("Job name is required.")}`);
  }

  const supabase = await createServerSupabaseClient();
  const address1 = readString(formData.get("address1"));
  const address2 = readString(formData.get("address2"));
  const city = readString(formData.get("city"));
  const state = readString(formData.get("state"));
  const postal = readString(formData.get("postal"));
  const { data, error } = await supabase
    .from("jobs")
    .insert({
      name,
      address1: toNullableText(address1),
      address2: toNullableText(address2),
      city: toNullableText(city),
      state: toNullableText(state),
      postal: toNullableText(postal),
      start_date: toNullableText(readString(formData.get("start_date"))),
      end_date: toNullableText(readString(formData.get("end_date"))),
      status: toNullableText(readString(formData.get("status"))) ?? "active",
      notes: toNullableText(readString(formData.get("notes"))),
    })
    .select("id")
    .single();

  if (error) {
    redirect(`/jobs?message=${encodeURIComponent(error.message)}`);
  }

  redirect(`/jobs/${data.id}`);
}

export default async function JobsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const message = firstValue(params.message);
  const supabase = await createServerSupabaseClient();
  const { data: jobs, error } = await supabase.from("jobs").select("*").order("created_at", { ascending: false });
  if (error) {
    throw new Error(`Failed to load jobs: ${error.message}`);
  }
  const jobCount = jobs?.length ?? 0;
  const showingCountLabel = `Showing ${jobCount} job${jobCount === 1 ? "" : "s"}`;

  return (
    <section className="space-y-6">
      {message ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{message}</p>
      ) : null}

      <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
        <h2 className="text-lg font-semibold">Create Job</h2>
        <form action={createJobAction} className="mt-3 grid gap-3 md:grid-cols-2">
          <input name="name" placeholder="Job name" required />
          <input defaultValue="active" name="status" placeholder="Status" />
          <input name="address1" placeholder="Street address" />
          <input name="address2" placeholder="Address line 2" />
          <input name="city" placeholder="City" />
          <input name="state" placeholder="State" />
          <input name="postal" placeholder="Postal" />
          <input name="start_date" type="date" />
          <input name="end_date" type="date" />
          <textarea className="md:col-span-2" name="notes" placeholder="Notes" />
          <button className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground md:col-span-2" type="submit">
            Create Job
          </button>
        </form>
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-4 py-3 text-sm font-medium text-muted">{showingCountLabel}</div>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Dates</th>
              <th>Address</th>
            </tr>
          </thead>
          <tbody>
            {(jobs ?? []).length === 0 ? (
              <tr>
                <td className="text-sm text-muted" colSpan={4}>
                  No jobs yet.
                </td>
              </tr>
            ) : (
              (jobs ?? []).map((job) => (
                <tr key={job.id}>
                  <td>
                    <Link className="font-medium text-accent hover:underline" href={`/jobs/${job.id}`}>
                      {job.name}
                    </Link>
                  </td>
                  <td>{job.status}</td>
                  <td>
                    {job.start_date ?? "—"} to {job.end_date ?? "—"}
                  </td>
                  <td>{buildAddressLabel([job.address1 ?? "", job.address2 ?? "", job.city ?? "", job.state ?? "", job.postal ?? ""]) ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </section>
  );
}
