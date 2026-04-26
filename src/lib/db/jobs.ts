import "server-only";

import type { Database } from "@/lib/supabase/database.types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type JobRow = Database["public"]["Tables"]["jobs"]["Row"];

type JobCountRow = {
  job_id: string | null;
};

type SourceJobCountRow = {
  source_job_id: string | null;
};

type PostgrestLikeError = {
  code?: string;
  details?: string | null;
  message?: string;
};

const SCENE_SCHEMA_TOKENS = [
  "job_scene_applications",
  "scene_templates",
  "scene_template_items",
  "scene_application_id",
  "scene_template_item_id",
];

function isMissingSceneSchemaError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const value = error as PostgrestLikeError;
  const haystack = `${value.code ?? ""} ${value.message ?? ""} ${value.details ?? ""}`.toLowerCase();

  return SCENE_SCHEMA_TOKENS.some((token) => haystack.includes(token));
}

function countByKey(rows: JobCountRow[]) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    if (!row.job_id) {
      return acc;
    }

    acc[row.job_id] = (acc[row.job_id] ?? 0) + 1;
    return acc;
  }, {});
}

function countBySourceJobKey(rows: SourceJobCountRow[]) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    if (!row.source_job_id) {
      return acc;
    }

    acc[row.source_job_id] = (acc[row.source_job_id] ?? 0) + 1;
    return acc;
  }, {});
}

export type JobWithStats = Pick<
  JobRow,
  "id" | "name" | "status" | "address1" | "address2" | "address_label" | "city" | "state" | "postal" | "start_date" | "end_date" | "latitude" | "longitude"
> & {
  activeItemCount: number;
  importedItemCount: number;
  packRequestCount: number;
  sceneApplicationCount: number;
};

export async function listJobsWithStats(): Promise<JobWithStats[]> {
  const supabase = await createServerSupabaseClient();
  const { data: jobs, error: jobsError } = await supabase
    .from("jobs")
    .select("id,name,status,address1,address2,address_label,city,state,postal,start_date,end_date,latitude,longitude")
    .order("created_at", { ascending: false });

  if (jobsError) {
    throw new Error(`Failed to load jobs: ${jobsError.message}`);
  }

  if ((jobs ?? []).length === 0) {
    return [] as JobWithStats[];
  }

  const jobIds = (jobs ?? []).map((job) => job.id);
  const [
    { data: activeAssignments, error: activeError },
    { data: importedItems, error: importedError },
    { data: packRequests, error: packRequestsError },
    { data: sceneApplications, error: sceneApplicationsError },
  ] = await Promise.all([
    supabase.from("job_items").select("job_id").in("job_id", jobIds).is("checked_in_at", null),
    supabase.from("inventory_items").select("source_job_id").in("source_job_id", jobIds),
    supabase.from("job_pack_requests").select("job_id").in("job_id", jobIds).neq("status", "cancelled"),
    supabase.from("job_scene_applications").select("job_id").in("job_id", jobIds),
  ]);

  if (activeError) {
    throw new Error(`Failed to load active assignments: ${activeError.message}`);
  }
  if (importedError) {
    throw new Error(`Failed to load imported inventory counts: ${importedError.message}`);
  }
  if (packRequestsError) {
    throw new Error(`Failed to load pack request counts: ${packRequestsError.message}`);
  }
  if (sceneApplicationsError && !isMissingSceneSchemaError(sceneApplicationsError)) {
    throw new Error(`Failed to load scene application counts: ${sceneApplicationsError.message}`);
  }

  const activeByJobId = countByKey((activeAssignments ?? []) as JobCountRow[]);
  const importedByJobId = countBySourceJobKey((importedItems ?? []) as SourceJobCountRow[]);
  const packRequestsByJobId = countByKey((packRequests ?? []) as JobCountRow[]);
  const sceneApplicationsByJobId = countByKey((sceneApplications ?? []) as JobCountRow[]);

  return (jobs ?? []).map((job) => ({
    ...job,
    activeItemCount: activeByJobId[job.id] ?? 0,
    importedItemCount: importedByJobId[job.id] ?? 0,
    packRequestCount: packRequestsByJobId[job.id] ?? 0,
    sceneApplicationCount: sceneApplicationsByJobId[job.id] ?? 0,
  }));
}
