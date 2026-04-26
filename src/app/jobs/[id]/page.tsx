import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import {
  applySceneTemplateToJob,
  createJobPickItem,
  createPackRequest,
  createSceneTemplateFromJobRoom,
  deleteJobPickItem,
  deletePackRequest,
  deleteSceneApplication,
  getJobDetail,
  listPackListInventoryItems,
  listSceneTemplates,
  togglePackRequestOptional,
  updateJob,
  updatePackRequest,
  updatePackRequestStatus,
  type JobPackRequest,
} from "@/lib/db/job-details";
import { assignItemToJob, checkInItem } from "@/lib/db/inventory";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const primaryButtonClass = "inline-flex items-center justify-center rounded-xl bg-[#c96f3d] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#b86133]";
const secondaryButtonClass =
  "inline-flex items-center justify-center rounded-xl border border-[#e3d0ba] bg-white px-4 py-2.5 text-sm font-semibold text-[#33413b] transition hover:bg-[#fffaf4]";
const sectionCardClass = "rounded-3xl border border-[#e8d9c6] bg-[#fffdf9] p-5 shadow-sm";
const mutedTextClass = "text-sm leading-6 text-[#6f756c]";

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function readString(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function readBoolean(value: FormDataEntryValue | null) {
  return value === "on" || value === "true" || value === "1";
}

function formatAddress(job: {
  address_label?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  postal?: string | null;
}) {
  if (job.address_label) {
    return job.address_label;
  }

  return [job.address1, job.address2, job.city, job.state, job.postal].filter(Boolean).join(", ");
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function detailsOpen(activeSection: string | null, sectionName: string, fallback = false) {
  return fallback || activeSection === sectionName;
}

function buildJobUrl(
  jobId: string,
  {
    message,
    tone,
    section,
    editRequestId,
  }: {
    message?: string;
    tone?: "success" | "error";
    section?: string;
    editRequestId?: string | null;
  } = {},
) {
  const params = new URLSearchParams();

  if (message) {
    params.set("message", message);
  }
  if (tone) {
    params.set("tone", tone);
  }
  if (section) {
    params.set("section", section);
  }
  if (editRequestId) {
    params.set("edit_request", editRequestId);
  }

  const query = params.toString();
  return query ? `/jobs/${jobId}?${query}` : `/jobs/${jobId}`;
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#ecdcc7] bg-[#fff8ef] px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8c8c7b]">{label}</p>
      <p className="mt-2 text-lg font-semibold text-[#20322a]">{value}</p>
    </div>
  );
}

function SectionHeader({
  title,
  description,
  right,
}: {
  title: string;
  description?: string;
  right?: import("react").ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold text-[#20322a]">{title}</h2>
        {description ? <p className={`mt-2 ${mutedTextClass}`}>{description}</p> : null}
      </div>
      {right}
    </div>
  );
}

export default async function JobDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const search = await searchParams;
  const message = firstValue(search.message);
  const tone = firstValue(search.tone) === "error" ? "error" : "success";
  const activeSection = firstValue(search.section) ?? null;
  const editRequestId = firstValue(search.edit_request) ?? null;

  async function resolveRequestedItem(itemId: string) {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.from("inventory_items").select("name,category,color").eq("id", itemId).maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    return data;
  }

  async function updateJobAction(formData: FormData) {
    "use server";

    const name = readString(formData.get("name"));
    const status = readString(formData.get("status"));

    if (!name) {
      redirect(buildJobUrl(id, { message: "Project name is required.", tone: "error", section: "edit-project" }));
    }
    if (!status) {
      redirect(buildJobUrl(id, { message: "Project status is required.", tone: "error", section: "edit-project" }));
    }

    try {
      await updateJob({
        jobId: id,
        name,
        address1: readString(formData.get("address1")),
        address2: readString(formData.get("address2")),
        city: readString(formData.get("city")),
        state: readString(formData.get("state")),
        postal: readString(formData.get("postal")),
        notes: readString(formData.get("notes")),
        status,
      });
      redirect(buildJobUrl(id, { message: "Project updated.", tone: "success" }));
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : "Failed to update project.";
      redirect(buildJobUrl(id, { message: nextMessage, tone: "error", section: "edit-project" }));
    }
  }

  async function savePackRequestAction(formData: FormData) {
    "use server";

    const packRequestId = readString(formData.get("pack_request_id"));
    const requestText = readString(formData.get("request_text"));
    const selectedItemId = readString(formData.get("requested_item_id"));
    const requestQuantity = Number.parseInt(readString(formData.get("quantity")), 10);
    const room = readString(formData.get("room"));
    const category = readString(formData.get("category"));
    const color = readString(formData.get("color"));
    const notes = readString(formData.get("notes"));
    const optional = readBoolean(formData.get("optional"));
    const editRedirectId = packRequestId || null;
    const requestedItem = selectedItemId ? await resolveRequestedItem(selectedItemId) : null;
    const resolvedText = requestText || requestedItem?.name || "";
    const resolvedCategory = category || requestedItem?.category || "";
    const resolvedColor = color || requestedItem?.color || "";

    if (!resolvedText) {
      redirect(buildJobUrl(id, { message: "Add a request description or choose an inventory item.", tone: "error", section: "add-pack-list", editRequestId: editRedirectId }));
    }

    if (!Number.isFinite(requestQuantity) || requestQuantity < 1) {
      redirect(buildJobUrl(id, { message: "Quantity must be at least 1.", tone: "error", section: "add-pack-list", editRequestId: editRedirectId }));
    }

    try {
      if (packRequestId) {
        await updatePackRequest({
          packRequestId,
          requestText: resolvedText,
          quantity: requestQuantity,
          room,
          category: resolvedCategory,
          color: resolvedColor,
          notes,
          optional,
          requestedItemId: selectedItemId || null,
        });
        redirect(buildJobUrl(id, { message: "Pack request updated.", tone: "success", section: "pack-requests" }));
      }

      await createPackRequest({
        jobId: id,
        requestText: resolvedText,
        quantity: requestQuantity,
        room,
        category: resolvedCategory,
        color: resolvedColor,
        notes,
        optional,
        requestedItemId: selectedItemId || null,
      });
      redirect(buildJobUrl(id, { message: "Pack request added.", tone: "success", section: "pack-requests" }));
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : packRequestId ? "Failed to update pack request." : "Failed to add pack request.";
      redirect(buildJobUrl(id, { message: nextMessage, tone: "error", section: "add-pack-list", editRequestId: editRedirectId }));
    }
  }

  async function toggleOptionalAction(formData: FormData) {
    "use server";

    const packRequestId = readString(formData.get("pack_request_id"));
    if (!packRequestId) {
      redirect(buildJobUrl(id, { message: "Pack request is required.", tone: "error", section: "pack-requests" }));
    }

    try {
      const nextOptional = await togglePackRequestOptional(packRequestId);
      redirect(buildJobUrl(id, {
        message: `Pack request marked ${nextOptional ? "optional" : "required"}.`,
        tone: "success",
        section: "pack-requests",
      }));
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : "Failed to update pack request.";
      redirect(buildJobUrl(id, { message: nextMessage, tone: "error", section: "pack-requests" }));
    }
  }

  async function cancelPackRequestAction(formData: FormData) {
    "use server";

    const packRequestId = readString(formData.get("pack_request_id"));
    if (!packRequestId) {
      redirect(buildJobUrl(id, { message: "Pack request is required.", tone: "error", section: "pack-requests" }));
    }

    try {
      await updatePackRequestStatus(packRequestId, "cancelled");
      redirect(buildJobUrl(id, { message: "Pack request updated.", tone: "success", section: "pack-requests" }));
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : "Failed to update pack request.";
      redirect(buildJobUrl(id, { message: nextMessage, tone: "error", section: "pack-requests" }));
    }
  }

  async function deletePackRequestAction(formData: FormData) {
    "use server";

    const packRequestId = readString(formData.get("pack_request_id"));
    if (!packRequestId) {
      redirect(buildJobUrl(id, { message: "Pack request is required.", tone: "error", section: "pack-requests" }));
    }

    try {
      await deletePackRequest(packRequestId);
      redirect(buildJobUrl(id, { message: "Pack request removed.", tone: "success", section: "pack-requests" }));
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : "Failed to remove pack request.";
      redirect(buildJobUrl(id, { message: nextMessage, tone: "error", section: "pack-requests" }));
    }
  }

  async function assignItemAction(formData: FormData) {
    "use server";

    const itemId = readString(formData.get("item_id"));
    const section = readString(formData.get("section")) || "pack-requests";
    if (!itemId) {
      redirect(buildJobUrl(id, { message: "Inventory item is required.", tone: "error", section }));
    }

    try {
      await assignItemToJob(id, itemId);
      redirect(buildJobUrl(id, { message: "Item assigned.", tone: "success", section }));
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : "Failed to assign item.";
      redirect(buildJobUrl(id, { message: nextMessage, tone: "error", section }));
    }
  }

  async function checkInItemAction(formData: FormData) {
    "use server";

    const jobItemId = readString(formData.get("job_item_id"));
    if (!jobItemId) {
      redirect(buildJobUrl(id, { message: "Job item is required.", tone: "error", section: "assignments" }));
    }

    try {
      await checkInItem(jobItemId);
      redirect(buildJobUrl(id, { message: "Item checked in.", tone: "success", section: "assignments" }));
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : "Failed to check in item.";
      redirect(buildJobUrl(id, { message: nextMessage, tone: "error", section: "assignments" }));
    }
  }

  async function logPickedItemAction(formData: FormData) {
    "use server";

    const itemId = readString(formData.get("item_id"));
    const packRequestId = readString(formData.get("pack_request_id"));
    const section = readString(formData.get("section")) || "pack-requests";
    if (!itemId) {
      redirect(buildJobUrl(id, { message: "Inventory item is required.", tone: "error", section }));
    }

    try {
      await createJobPickItem({
        jobId: id,
        itemId,
        packRequestId: packRequestId || null,
      });
      redirect(buildJobUrl(id, { message: "Exact item logged.", tone: "success", section }));
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : "Failed to log exact item.";
      redirect(buildJobUrl(id, { message: nextMessage, tone: "error", section }));
    }
  }

  async function deletePickedItemAction(formData: FormData) {
    "use server";

    const jobPickItemId = readString(formData.get("job_pick_item_id"));
    const section = readString(formData.get("section")) || "pack-requests";
    if (!jobPickItemId) {
      redirect(buildJobUrl(id, { message: "Picked item is required.", tone: "error", section }));
    }

    try {
      await deleteJobPickItem(jobPickItemId);
      redirect(buildJobUrl(id, { message: "Exact project item removed.", tone: "success", section }));
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : "Failed to remove exact item.";
      redirect(buildJobUrl(id, { message: nextMessage, tone: "error", section }));
    }
  }

  async function quickSelectAction(formData: FormData) {
    "use server";

    const selectedItemIds = formData.getAll("item_ids").map((value) => (typeof value === "string" ? value : "")).filter(Boolean);
    const packRequestId = readString(formData.get("pack_request_id"));
    const notes = readString(formData.get("notes"));

    if (selectedItemIds.length === 0) {
      redirect(buildJobUrl(id, { message: "Choose at least one inventory item to log.", tone: "error", section: "quick-select" }));
    }

    try {
      let resolvedPackRequestId = packRequestId || null;
      const resolvedNotes = notes || `Bulk pack request at ${new Date().toLocaleString()}`;

      if (!resolvedPackRequestId) {
        resolvedPackRequestId = await createPackRequest({
          jobId: id,
          requestText: resolvedNotes,
          quantity: selectedItemIds.length,
          room: "",
          category: "",
          color: "",
          notes: resolvedNotes,
          optional: false,
          requestedItemId: null,
        });
      }

      let successCount = 0;
      let failureMessage: string | null = null;

      for (const itemId of selectedItemIds) {
        try {
          await createJobPickItem({
            jobId: id,
            itemId,
            packRequestId: resolvedPackRequestId,
            notes: resolvedNotes,
          });
          successCount += 1;
        } catch (error) {
          if (!failureMessage) {
            failureMessage = error instanceof Error ? error.message : `Failed to log item ${itemId}.`;
          }
        }
      }

      if (failureMessage) {
        redirect(buildJobUrl(id, {
          message: `Logged ${successCount} item${successCount === 1 ? "" : "s"}. ${failureMessage}`,
          tone: "error",
          section: "quick-select",
        }));
      }

      redirect(buildJobUrl(id, {
        message: packRequestId ? `Logged ${successCount} quick select item${successCount === 1 ? "" : "s"} for request.` : `Created bulk pack request with ${successCount} item${successCount === 1 ? "" : "s"}.`,
        tone: "success",
        section: "quick-select",
      }));
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : "Failed to log quick select items.";
      redirect(buildJobUrl(id, { message: nextMessage, tone: "error", section: "quick-select" }));
    }
  }

  async function applySceneTemplateAction(formData: FormData) {
    "use server";

    const sceneTemplateId = readString(formData.get("scene_template_id"));
    const roomLabel = readString(formData.get("room_label"));
    const notes = readString(formData.get("notes"));

    if (!sceneTemplateId) {
      redirect(buildJobUrl(id, { message: "Scene template is required.", tone: "error", section: "scene-templates" }));
    }

    try {
      const result = await applySceneTemplateToJob({
        jobId: id,
        sceneTemplateId,
        roomLabel,
        notes,
      });
      redirect(buildJobUrl(id, { message: `${result.sceneName} added to the pack list for ${roomLabel}.`, tone: "success", section: "scene-templates" }));
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : "Failed to apply scene template.";
      redirect(buildJobUrl(id, { message: nextMessage, tone: "error", section: "scene-templates" }));
    }
  }

  async function deleteSceneApplicationAction(formData: FormData) {
    "use server";

    const sceneApplicationId = readString(formData.get("scene_application_id"));
    const sceneName = readString(formData.get("scene_name"));
    if (!sceneApplicationId) {
      redirect(buildJobUrl(id, { message: "Scene application is required.", tone: "error", section: "scene-templates" }));
    }

    try {
      await deleteSceneApplication(sceneApplicationId);
      redirect(buildJobUrl(id, { message: `${sceneName || "Scene"} removed from this project.`, tone: "success", section: "scene-templates" }));
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : "Failed to remove scene application.";
      redirect(buildJobUrl(id, { message: nextMessage, tone: "error", section: "scene-templates" }));
    }
  }

  async function createSceneTemplateAction(formData: FormData) {
    "use server";

    const sourceRoom = readString(formData.get("source_room"));
    const name = readString(formData.get("name"));

    if (!sourceRoom) {
      redirect(buildJobUrl(id, { message: "Choose a project room to save as a reusable scene.", tone: "error", section: "scene-templates" }));
    }
    if (!name) {
      redirect(buildJobUrl(id, { message: "Scene template name is required.", tone: "error", section: "scene-templates" }));
    }

    try {
      const result = await createSceneTemplateFromJobRoom({
        jobId: id,
        sourceRoom,
        name,
        roomType: readString(formData.get("room_type")),
        styleLabel: readString(formData.get("style_label")),
        summary: readString(formData.get("summary")),
        notes: readString(formData.get("notes")),
      });
      redirect(buildJobUrl(id, {
        message: `Saved ${result.sceneName} with ${result.itemCount} room request${result.itemCount === 1 ? "" : "s"}.`,
        tone: "success",
        section: "scene-templates",
      }));
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : "Failed to save room as a reusable scene.";
      redirect(buildJobUrl(id, { message: nextMessage, tone: "error", section: "scene-templates" }));
    }
  }

  const [{ job, assignments, packRequests, pickedItems, sceneApplications }, packCandidates, sceneTemplates] = await Promise.all([
    getJobDetail(id).catch((error) => {
      if (error instanceof Error && /0 rows|No rows/i.test(error.message)) {
        notFound();
      }
      throw error;
    }),
    listPackListInventoryItems(),
    listSceneTemplates(),
  ]);

  const projectLocation = formatAddress(job);
  const projectSubtitle = [projectLocation, job.status].filter(Boolean).join(" • ");
  const activeAssignments = assignments.filter((assignment) => !assignment.checked_in_at);
  const completedAssignments = assignments.filter((assignment) => Boolean(assignment.checked_in_at));
  const activeAssignedItemIds = new Set(activeAssignments.map((assignment) => assignment.item_id));
  const openPackRequests = packRequests.filter((request) => request.status !== "cancelled");
  const fulfilledRequestCount = openPackRequests.filter((request) => request.picked_count >= request.quantity).length;
  const openPackRequestsByRoom = Object.entries(
    openPackRequests.reduce<Record<string, JobPackRequest[]>>((acc, request) => {
      const key = (request.room ?? "").trim() || "No room";
      acc[key] = [...(acc[key] ?? []), request];
      return acc;
    }, {}),
  ).sort(([a], [b]) => {
    if (a === "No room") return 1;
    if (b === "No room") return -1;
    return a.localeCompare(b);
  });
  const extraPickedItems = pickedItems.filter((pickedItem) => !pickedItem.pack_request_id);
  const editingPackRequest = editRequestId ? openPackRequests.find((request) => request.id === editRequestId) ?? null : null;
  const authorableRooms = openPackRequestsByRoom.filter(([roomLabel]) => roomLabel !== "No room");
  const defaultSceneSourceRoom = authorableRooms[0]?.[0] ?? "";
  const appliedSceneCountByTemplateId = sceneApplications.reduce<Record<string, number>>((acc, application) => {
    acc[application.scene_template_id] = (acc[application.scene_template_id] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <section className="space-y-6 pb-10">
      <header className="rounded-[2rem] bg-[#16382d] px-6 py-6 text-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#c7d8cd]">Project</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">{job.name}</h1>
            <p className="mt-4 text-lg text-[#d8e6dd]">{projectSubtitle || "Project detail"}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link className={secondaryButtonClass} href={buildJobUrl(id, { section: "edit-project" })}>
              Edit Details
            </Link>
            <Link className={secondaryButtonClass} href="/jobs">
              Back to Projects
            </Link>
          </div>
        </div>
      </header>

      {message ? (
        <p
          className={[
            "rounded-2xl border px-4 py-3 text-sm shadow-sm",
            tone === "error" ? "border-rose-200 bg-rose-50 text-rose-900" : "border-emerald-200 bg-emerald-50 text-emerald-900",
          ].join(" ")}
        >
          {message}
        </p>
      ) : null}

      <details className={sectionCardClass} open={detailsOpen(activeSection, "edit-project")}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
          <SectionHeader
            title="Edit Project Details"
            description="Client name, map address, notes, and status live here."
            right={<span className={secondaryButtonClass}>Toggle</span>}
          />
        </summary>

        <form action={updateJobAction} className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="mb-2 block text-sm font-semibold text-[#33413b]">Client / Project Name</label>
            <input defaultValue={job.name} name="name" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-[#33413b]">Street Address</label>
            <input defaultValue={job.address1 ?? ""} name="address1" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-[#33413b]">Address Line 2</label>
            <input defaultValue={job.address2 ?? ""} name="address2" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-[#33413b]">City</label>
            <input defaultValue={job.city ?? ""} name="city" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-[#33413b]">State</label>
            <input defaultValue={job.state ?? ""} name="state" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-[#33413b]">Postal Code</label>
            <input defaultValue={job.postal ?? ""} name="postal" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-[#33413b]">Status</label>
            <input defaultValue={job.status} name="status" />
          </div>
          <div className="rounded-2xl border border-[#ecdcc7] bg-[#fff8ef] px-4 py-3 md:col-span-2">
            <p className={mutedTextClass}>
              {projectLocation ? `Map address: ${projectLocation}, US` : "Add a full address so this project can be pinned on a map later."}
            </p>
            <p className={`${mutedTextClass} mt-2`}>
              {job.latitude != null && job.longitude != null
                ? `Stored coordinates: ${job.latitude.toFixed(5)}, ${job.longitude.toFixed(5)}`
                : "Coordinates not stored yet."}
            </p>
          </div>
          <div className="md:col-span-2">
            <label className="mb-2 block text-sm font-semibold text-[#33413b]">Notes</label>
            <textarea defaultValue={job.notes ?? ""} name="notes" />
          </div>
          <div className="md:col-span-2">
            <button className={primaryButtonClass} type="submit">
              Save Project Details
            </button>
          </div>
        </form>
      </details>

      <section className={sectionCardClass}>
        <SectionHeader
          title="Pack List"
          description="Pack requests describe designer intent. Exact picks describe what actually got loaded or left at the house."
        />
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <MetricCard label="Requests Total" value={String(openPackRequests.length)} />
          <MetricCard label="Fully Covered" value={String(fulfilledRequestCount)} />
          <MetricCard label="Exact Items Logged" value={String(pickedItems.length)} />
        </div>
        <p className={`${mutedTextClass} mt-4`}>
          {sceneApplications.length} applied scene{sceneApplications.length === 1 ? "" : "s"} are currently feeding this room-by-room pack list.
        </p>
      </section>

      <details className={sectionCardClass} open={detailsOpen(activeSection, "add-pack-list", Boolean(editingPackRequest))}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
          <SectionHeader
            title={editingPackRequest ? "Edit Pack Request" : "Add to Pack List"}
            description={
              editingPackRequest
                ? "Update this request here, then save or cancel the edit state."
                : "Create new pack requests or link an exact inventory item to one."
            }
            right={<span className={secondaryButtonClass}>{editingPackRequest ? "Editing" : "Toggle"}</span>}
          />
        </summary>

        <form action={savePackRequestAction} className="mt-5 grid gap-4 md:grid-cols-2">
          {editingPackRequest ? <input name="pack_request_id" type="hidden" value={editingPackRequest.id} /> : null}
          <div className="md:col-span-2">
            <label className="mb-2 block text-sm font-semibold text-[#33413b]">Request</label>
            <input defaultValue={editingPackRequest?.request_text ?? ""} name="request_text" placeholder="4 blue pillows, 1 ladder, dining table art..." />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-[#33413b]">Quantity</label>
            <input defaultValue={String(editingPackRequest?.quantity ?? 1)} min={1} name="quantity" type="number" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-[#33413b]">Room</label>
            <input defaultValue={editingPackRequest?.room ?? ""} name="room" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-[#33413b]">Category</label>
            <input defaultValue={editingPackRequest?.category ?? ""} name="category" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-[#33413b]">Color</label>
            <input defaultValue={editingPackRequest?.color ?? ""} name="color" />
          </div>
          <div className="md:col-span-2">
            <label className="mb-2 block text-sm font-semibold text-[#33413b]">Notes</label>
            <textarea defaultValue={editingPackRequest?.notes ?? ""} name="notes" placeholder="Optional styling notes, alternates, or client preferences." />
          </div>
          <label className="flex items-center gap-3 text-sm font-medium text-[#33413b] md:col-span-2">
            <input defaultChecked={editingPackRequest?.optional ?? false} name="optional" type="checkbox" />
            Mark as optional
          </label>
          <div className="md:col-span-2">
            <label className="mb-2 block text-sm font-semibold text-[#33413b]">Link Exact Inventory Item</label>
            <select defaultValue={editingPackRequest?.requested_item_id ?? ""} name="requested_item_id">
              <option value="">No exact inventory item linked</option>
              {packCandidates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.item_code ?? "No code"}) • {item.status} • {item.current_location_name ?? "No location"}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-3 md:col-span-2">
            <button className={primaryButtonClass} type="submit">
              {editingPackRequest ? "Save Pack Request" : "Add Pack Request"}
            </button>
            {editingPackRequest ? (
              <Link className={secondaryButtonClass} href={buildJobUrl(id, { section: "add-pack-list" })}>
                Cancel Edit
              </Link>
            ) : null}
          </div>
        </form>
      </details>

      <details className={sectionCardClass} open={detailsOpen(activeSection, "quick-select")}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
          <SectionHeader
            title="Quick Select"
            description="Log multiple exact items at once. If you do not choose an existing request, the web page will create a grouped bulk request for them."
            right={<span className={secondaryButtonClass}>Toggle</span>}
          />
        </summary>

        <form action={quickSelectAction} className="mt-5 grid gap-4">
          <div>
            <label className="mb-2 block text-sm font-semibold text-[#33413b]">Log against existing pack request</label>
            <select defaultValue="" name="pack_request_id">
              <option value="">Create a generated bulk pack request</option>
              {openPackRequests.map((request) => (
                <option key={request.id} value={request.id}>
                  {request.quantity} x {request.request_text} {request.room ? `• ${request.room}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-[#33413b]">Pick Notes</label>
            <textarea name="notes" placeholder="Optional notes about why these items satisfied the request." />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-[#33413b]">Inventory Items</label>
            <select className="min-h-72" multiple name="item_ids">
              {packCandidates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.item_code ?? "No code"}) • {item.status} • {item.current_location_name ?? "No location"}
                </option>
              ))}
            </select>
            <p className={`mt-2 ${mutedTextClass}`}>Hold Command on Mac or Control on Windows to select multiple items.</p>
          </div>
          <div>
            <button className={primaryButtonClass} type="submit">
              Log Quick Select
            </button>
          </div>
        </form>
      </details>

      <details className={sectionCardClass} open={detailsOpen(activeSection, "scene-templates")}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
          <SectionHeader
            title="Scene Templates"
            description="Use reusable room recipes to generate grouped pack requests from staging patterns you repeat often."
            right={<span className={secondaryButtonClass}>Toggle</span>}
          />
        </summary>

        <div className="mt-5 space-y-6">
          <div>
            <h3 className="text-lg font-semibold text-[#20322a]">Applied Scenes</h3>
            <p className={`mt-2 ${mutedTextClass}`}>These are the reusable scenes already feeding this project&apos;s pack list.</p>
            <div className="mt-4 space-y-3">
              {sceneApplications.length === 0 ? (
                <p className={mutedTextClass}>No reusable scenes applied yet.</p>
              ) : (
                sceneApplications.map((application) => (
                  <div key={application.id} className="rounded-2xl border border-[#ecdcc7] bg-[#fff8ef] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-lg font-semibold text-[#20322a]">
                          {application.scene_template_name} for {application.room_label}
                        </p>
                        <p className={`${mutedTextClass} mt-2`}>
                          {application.pack_request_count} requests • {application.fulfilled_request_count} fully covered
                        </p>
                        {application.notes ? <p className={`${mutedTextClass} mt-2`}>Notes: {application.notes}</p> : null}
                      </div>
                      <form action={deleteSceneApplicationAction}>
                        <input name="scene_application_id" type="hidden" value={application.id} />
                        <input name="scene_name" type="hidden" value={application.scene_template_name} />
                        <button className={secondaryButtonClass} type="submit">
                          Remove Scene
                        </button>
                      </form>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-[#20322a]">Available Templates</h3>
            <div className="mt-4 space-y-4">
              {sceneTemplates.length === 0 ? (
                <p className={mutedTextClass}>No reusable templates are available yet.</p>
              ) : (
                sceneTemplates.map((template) => (
                  <form key={template.id} action={applySceneTemplateAction} className="rounded-2xl border border-[#ecdcc7] bg-white p-4">
                    <input name="scene_template_id" type="hidden" value={template.id} />
                    <div className="space-y-3">
                      <div>
                        <p className="text-lg font-semibold text-[#20322a]">{template.name}</p>
                        <p className={mutedTextClass}>
                          {template.room_type ?? "Room"} • {template.style_label ?? "General"} • {template.item_count} template item{template.item_count === 1 ? "" : "s"}
                        </p>
                        {template.summary ? <p className={`${mutedTextClass} mt-2`}>{template.summary}</p> : null}
                        {(appliedSceneCountByTemplateId[template.id] ?? 0) > 0 ? (
                          <p className={`${mutedTextClass} mt-2`}>
                            Applied {appliedSceneCountByTemplateId[template.id]} time{appliedSceneCountByTemplateId[template.id] === 1 ? "" : "s"} on this project.
                          </p>
                        ) : null}
                      </div>
                      <div className="rounded-2xl border border-[#f0e4d3] bg-[#fffaf4] p-3">
                        <div className="space-y-1">
                          {template.items.map((item) => (
                            <p key={item.id} className="text-sm text-[#4e584f]">
                              {item.quantity} x {item.request_text}
                              {item.category ? ` • ${item.category}` : ""}
                              {item.color ? ` • ${item.color}` : ""}
                              {item.optional ? " • optional" : ""}
                            </p>
                          ))}
                        </div>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <label className="mb-2 block text-sm font-semibold text-[#33413b]">Apply as room</label>
                          <input defaultValue={template.room_type ?? template.name} name="room_label" />
                        </div>
                        <div>
                          <label className="mb-2 block text-sm font-semibold text-[#33413b]">Scene notes</label>
                          <input name="notes" placeholder="Optional note for this scene application" />
                        </div>
                      </div>
                      <div>
                        <button className={primaryButtonClass} type="submit">
                          Apply Scene to Project
                        </button>
                      </div>
                    </div>
                  </form>
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-[#ecdcc7] bg-white p-4">
            <h3 className="text-lg font-semibold text-[#20322a]">Save Current Room as Scene</h3>
            <p className={`mt-2 ${mutedTextClass}`}>
              Snapshot a room&apos;s current pack requests into a reusable scene template so future projects can start from the same recipe.
            </p>
            {authorableRooms.length === 0 ? (
              <p className={`mt-4 ${mutedTextClass}`}>Add pack requests to a named room first, then save that room as a reusable scene.</p>
            ) : (
              <form action={createSceneTemplateAction} className="mt-5 grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-semibold text-[#33413b]">Source room</label>
                  <input defaultValue={defaultSceneSourceRoom} name="source_room" placeholder={authorableRooms.map(([roomLabel]) => roomLabel).join(", ")} />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold text-[#33413b]">Scene template name</label>
                  <input name="name" placeholder="Organic primary bedroom" />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold text-[#33413b]">Room type</label>
                  <input defaultValue={defaultSceneSourceRoom} name="room_type" placeholder="Primary Bedroom" />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold text-[#33413b]">Style label</label>
                  <input name="style_label" placeholder="Soft organic" />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm font-semibold text-[#33413b]">Summary</label>
                  <textarea name="summary" placeholder="Short note about what defines this setup." />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm font-semibold text-[#33413b]">Template notes</label>
                  <textarea name="notes" placeholder="Anything worth remembering when this scene is reused." />
                </div>
                <div className="md:col-span-2">
                  <button className={primaryButtonClass} type="submit">
                    Save Room as New Scene
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </details>

      <section className={sectionCardClass}>
        <SectionHeader
          title="Pack Requests"
          description="Designer asks like mirrors, pillows, art, and kitchen styling live here, grouped by room."
          right={
            <Link className={secondaryButtonClass} href={buildJobUrl(id, { section: "add-pack-list" })}>
              Add Request
            </Link>
          }
        />
        <div className="mt-5 space-y-6">
          {openPackRequests.length === 0 ? (
            <p className={mutedTextClass}>No pack requests yet.</p>
          ) : (
            openPackRequestsByRoom.map(([roomLabel, requests]) => (
              <div key={roomLabel} className="space-y-4">
                <h3 className="text-lg font-semibold text-[#20322a]">
                  {roomLabel} ({requests.length})
                </h3>
                {requests.map((request) => {
                  const assignDisabled =
                    !request.requested_item_id || activeAssignedItemIds.has(request.requested_item_id) || request.requested_item_status !== "available";

                  return (
                    <article key={request.id} className="rounded-2xl border border-[#ecdcc7] bg-white p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="max-w-3xl">
                          <p className="text-xl font-semibold text-[#20322a]">
                            {request.quantity} x {request.request_text}
                          </p>
                          <p className={`${mutedTextClass} mt-2`}>
                            {request.room ?? "No room"} • {request.category ?? "No category"} • {request.color ?? "No color"}
                          </p>
                          {request.scene_template_name ? (
                            <p className={`${mutedTextClass} mt-2`}>
                              Scene: {request.scene_template_name}
                              {request.scene_room_label ? ` • ${request.scene_room_label}` : ""}
                            </p>
                          ) : null}
                        </div>
                        <span className="rounded-full bg-[#17352c] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[#d8e6dd]">
                          {request.status === "packed" ? "legacy packed" : request.status}
                        </span>
                      </div>

                      <div className="mt-4 space-y-2">
                        {request.optional ? <p className={mutedTextClass}>Optional item</p> : null}
                        <p className={request.picked_count >= request.quantity ? "text-sm leading-6 text-emerald-700" : mutedTextClass}>
                          Exact picks logged: {request.picked_count} of {request.quantity}
                        </p>
                        {request.requested_item_name ? (
                          <p className={mutedTextClass}>
                            Exact item: {request.requested_item_name} ({request.requested_item_code}) • {request.requested_item_status}
                          </p>
                        ) : null}
                        {request.active_job_names.length > 0 ? (
                          <p className="text-sm leading-6 text-rose-700">Also on active jobs: {request.active_job_names.join(", ")}</p>
                        ) : null}
                        {request.notes ? <p className={mutedTextClass}>Notes: {request.notes}</p> : null}
                      </div>

                      {request.picked_items.length > 0 ? (
                        <div className="mt-4 space-y-3">
                          {request.picked_items.map((pickedItem) => (
                            <div key={pickedItem.id} className="rounded-2xl border border-[#efe2d0] bg-[#fff8ef] p-3">
                              <p className="font-semibold text-[#20322a]">
                                {pickedItem.item_name} ({pickedItem.item_code})
                              </p>
                              <p className={`${mutedTextClass} mt-2`}>
                                {pickedItem.item_category ?? "No category"} • {pickedItem.item_color ?? "No color"} • {pickedItem.item_room ?? "No room"}
                              </p>
                              {pickedItem.notes ? <p className={`${mutedTextClass} mt-2`}>Pick notes: {pickedItem.notes}</p> : null}
                              <div className="mt-3 flex flex-wrap gap-2">
                                <Link className={secondaryButtonClass} href={`/inventory/${pickedItem.item_id}`}>
                                  Open Picked Item
                                </Link>
                                <form action={assignItemAction}>
                                  <input name="item_id" type="hidden" value={pickedItem.item_id} />
                                  <input name="section" type="hidden" value="pack-requests" />
                                  <button className={secondaryButtonClass} disabled={pickedItem.item_status !== "available"} type="submit">
                                    {pickedItem.item_status === "available"
                                      ? "Assign to Project"
                                      : pickedItem.item_status === "on_job"
                                        ? "Already Assigned"
                                        : "Unavailable"}
                                  </button>
                                </form>
                                <form action={deletePickedItemAction}>
                                  <input name="job_pick_item_id" type="hidden" value={pickedItem.id} />
                                  <input name="section" type="hidden" value="pack-requests" />
                                  <button className={secondaryButtonClass} type="submit">
                                    Remove Pick
                                  </button>
                                </form>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      <div className="mt-4 flex flex-wrap gap-2">
                        <Link className={secondaryButtonClass} href={buildJobUrl(id, { section: "add-pack-list", editRequestId: request.id })}>
                          Edit
                        </Link>
                        <form action={toggleOptionalAction}>
                          <input name="pack_request_id" type="hidden" value={request.id} />
                          <button className={secondaryButtonClass} type="submit">
                            {request.optional ? "Mark Required" : "Mark Optional"}
                          </button>
                        </form>
                        {request.requested_item_id ? (
                          <Link className={secondaryButtonClass} href={`/inventory/${request.requested_item_id}`}>
                            Open Exact Item
                          </Link>
                        ) : null}
                        {request.requested_item_id ? (
                          <form action={assignItemAction}>
                            <input name="item_id" type="hidden" value={request.requested_item_id} />
                            <input name="section" type="hidden" value="pack-requests" />
                            <button className={secondaryButtonClass} disabled={assignDisabled} type="submit">
                              {activeAssignedItemIds.has(request.requested_item_id)
                                ? "Already Assigned"
                                : request.requested_item_status !== "available"
                                  ? "Unavailable"
                                  : "Assign to Project"}
                            </button>
                          </form>
                        ) : null}
                        <Link className={secondaryButtonClass} href={buildJobUrl(id, { section: "quick-select" })}>
                          Pick for Request
                        </Link>
                        {request.requested_item_id ? (
                          <form action={logPickedItemAction}>
                            <input name="item_id" type="hidden" value={request.requested_item_id} />
                            <input name="pack_request_id" type="hidden" value={request.id} />
                            <input name="section" type="hidden" value="pack-requests" />
                            <button className={secondaryButtonClass} type="submit">
                              Log Exact Item
                            </button>
                          </form>
                        ) : null}
                        <form action={cancelPackRequestAction}>
                          <input name="pack_request_id" type="hidden" value={request.id} />
                          <button className={secondaryButtonClass} type="submit">
                            Cancel
                          </button>
                        </form>
                        <form action={deletePackRequestAction}>
                          <input name="pack_request_id" type="hidden" value={request.id} />
                          <button className={secondaryButtonClass} type="submit">
                            Delete
                          </button>
                        </form>
                      </div>
                    </article>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </section>

      <section className={sectionCardClass}>
        <SectionHeader
          title="Extra Items at House"
          description="These are legacy exact items logged for the project without a matching pack request."
        />
        <div className="mt-5 space-y-4">
          {extraPickedItems.length === 0 ? (
            <div className="rounded-2xl border border-[#ecdcc7] bg-white p-5">
              <p className="text-lg font-semibold text-[#20322a]">No unlinked items logged.</p>
              <p className={`${mutedTextClass} mt-2`}>
                New quick-select entries are grouped into generated bulk pack requests instead of being left unlinked.
              </p>
            </div>
          ) : (
            extraPickedItems.map((pickedItem) => (
              <article key={pickedItem.id} className="rounded-2xl border border-[#ecdcc7] bg-white p-4">
                <p className="text-lg font-semibold text-[#20322a]">
                  {pickedItem.item_name} ({pickedItem.item_code})
                </p>
                <p className={`${mutedTextClass} mt-2`}>
                  {pickedItem.item_category ?? "No category"} • {pickedItem.item_color ?? "No color"} • {pickedItem.item_room ?? "No room"}
                </p>
                {pickedItem.notes ? <p className={`${mutedTextClass} mt-2`}>Pick notes: {pickedItem.notes}</p> : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link className={secondaryButtonClass} href={`/inventory/${pickedItem.item_id}`}>
                    Open Item
                  </Link>
                  <form action={assignItemAction}>
                    <input name="item_id" type="hidden" value={pickedItem.item_id} />
                    <input name="section" type="hidden" value="extra-items" />
                    <button className={secondaryButtonClass} disabled={pickedItem.item_status !== "available"} type="submit">
                      {pickedItem.item_status === "available"
                        ? "Assign to Project"
                        : pickedItem.item_status === "on_job"
                          ? "Already Assigned"
                          : "Unavailable"}
                    </button>
                  </form>
                  <form action={deletePickedItemAction}>
                    <input name="job_pick_item_id" type="hidden" value={pickedItem.id} />
                    <input name="section" type="hidden" value="extra-items" />
                    <button className={secondaryButtonClass} type="submit">
                      Remove Pick
                    </button>
                  </form>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      <section className={sectionCardClass}>
        <SectionHeader
          title="Currently Assigned"
          description="These items are currently checked out to this project. Use Check In when the item physically returns from the house or stage."
        />
        <div className="mt-5 space-y-4">
          {activeAssignments.length === 0 ? (
            <p className={mutedTextClass}>No active assignments.</p>
          ) : (
            activeAssignments.map((assignment) => (
              <article key={assignment.id} className="rounded-2xl border border-[#ecdcc7] bg-white p-4">
                <p className="text-lg font-semibold text-[#20322a]">
                  {assignment.item_name} ({assignment.item_code})
                </p>
                <p className={`${mutedTextClass} mt-2`}>Category: {assignment.item_category ?? "Uncategorized"}</p>
                <p className={mutedTextClass}>Room: {assignment.item_room ?? "Not assigned"}</p>
                <p className={mutedTextClass}>Checked out: {formatTimestamp(assignment.checked_out_at)}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link className={secondaryButtonClass} href={`/inventory/${assignment.item_id}`}>
                    Open Item
                  </Link>
                  <form action={checkInItemAction}>
                    <input name="job_item_id" type="hidden" value={assignment.id} />
                    <button className={primaryButtonClass} type="submit">
                      Check In
                    </button>
                  </form>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      <section className={sectionCardClass}>
        <SectionHeader
          title="Checked In"
          description="Check-in closes the assignment and puts the inventory item back into available status."
        />
        <div className="mt-5 space-y-3">
          {completedAssignments.length === 0 ? (
            <p className={mutedTextClass}>No completed check-ins yet.</p>
          ) : (
            completedAssignments.map((assignment) => (
              <article key={assignment.id} className="rounded-2xl border border-[#ecdcc7] bg-white p-4">
                <p className="font-semibold text-[#20322a]">
                  {assignment.item_name} ({assignment.item_code})
                </p>
                <p className={`${mutedTextClass} mt-2`}>Checked in: {formatTimestamp(assignment.checked_in_at)}</p>
              </article>
            ))
          )}
        </div>
      </section>
    </section>
  );
}
