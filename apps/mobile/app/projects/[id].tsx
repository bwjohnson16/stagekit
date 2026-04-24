import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Image as CachedImage } from "expo-image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";

import { AppScreen, Card, EmptyState, Field, Hero, LoadingState, Message, PrimaryButton, SecondaryButton, SectionTitle } from "../../src/components/ui";
import { InventoryThumbnailPicker } from "../../src/components/inventory-thumbnail-picker";
import { useAuth } from "../../src/lib/auth";
import { listPackListInventoryItems, type InventoryPackCandidate } from "../../src/lib/inventory";
import {
  assignItemToJob,
  checkInJobItem,
  createJobPickItem,
  createPackRequest,
  deleteJobPickItem,
  deletePackRequest,
  getJobDetail,
  updateJob,
  updatePackRequest,
  updatePackRequestStatus,
  type JobAssignment,
  type JobDetail,
  type JobPackRequest,
  type JobPickItem,
  type JobSceneApplication,
} from "../../src/lib/jobs";
import { applySceneTemplateToJob, createSceneTemplateFromJobRoom, deleteSceneApplication, listSceneTemplates, type SceneTemplate } from "../../src/lib/scenes";
import { colors } from "../../src/lib/theme";
import { buildBulkPackRequestLabel } from "../../src/lib/user";

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function formatProjectAddress(parts: {
  address_label?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  postal?: string | null;
}) {
  if (parts.address_label) {
    return parts.address_label;
  }

  return [parts.address1, parts.address2, parts.city, parts.state, parts.postal].filter(Boolean).join(", ");
}

function PackRequestCard({
  request,
  saving,
  onEdit,
  onToggleOptional,
  onOpenItem,
  onPreview,
  onStartPicking,
  onLogRequestedItem,
  onOpenPickedItem,
  onAssignPickedItem,
  onRemovePickedItem,
  onAssign,
  assignDisabled,
  assignLabel,
  onCancel,
  onDelete,
}: {
  request: JobPackRequest;
  saving: boolean;
  onEdit: () => void;
  onToggleOptional: () => void;
  onOpenItem: () => void;
  onPreview: () => void;
  onStartPicking: () => void;
  onLogRequestedItem?: () => void;
  onOpenPickedItem: (pickedItemId: string) => void;
  onAssignPickedItem: (pickedItemId: string) => void;
  onRemovePickedItem: (jobPickItemId: string) => void;
  onAssign?: () => void;
  assignDisabled?: boolean;
  assignLabel?: string;
  onCancel: () => void;
  onDelete: () => void;
}) {
  return (
    <View
      style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 14, gap: 8, backgroundColor: colors.panel }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>
            {request.quantity} x {request.request_text}
          </Text>
          <Text style={{ color: colors.muted }}>
            {request.room ?? "No room"} • {request.category ?? "No category"} • {request.color ?? "No color"}
          </Text>
          {request.scene_template_name ? (
            <Text style={{ color: colors.muted }}>
              Scene: {request.scene_template_name}
              {request.scene_room_label ? ` • ${request.scene_room_label}` : ""}
            </Text>
          ) : null}
        </View>
        <View
          style={{
            alignSelf: "flex-start",
            backgroundColor: request.status === "packed" ? colors.successBg : colors.panelAlt,
            borderRadius: 999,
            paddingHorizontal: 10,
            paddingVertical: 6,
          }}
        >
          <Text style={{ color: request.status === "packed" ? colors.successText : "#d8e6dd", fontSize: 12, fontWeight: "700" }}>{request.status === "packed" ? "legacy packed" : request.status}</Text>
        </View>
      </View>
      {request.optional ? <Text style={{ color: colors.muted }}>Optional item</Text> : null}
      <Text style={{ color: request.picked_count >= request.quantity ? colors.successText : colors.muted }}>
        Exact picks logged: {request.picked_count} of {request.quantity}
      </Text>
      {request.requested_item_name ? (
        <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
          {request.requested_item_thumbnail_url ? (
            <Pressable onPress={onPreview}>
              <CachedImage
                alt=""
                cachePolicy="memory-disk"
                contentFit="cover"
                source={{ uri: request.requested_item_thumbnail_url }}
                style={{ width: 72, height: 72, borderRadius: 12, backgroundColor: colors.panelAlt }}
              />
            </Pressable>
          ) : null}
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: colors.muted }}>
              Exact item: {request.requested_item_name} ({request.requested_item_code}) • {request.requested_item_status}
            </Text>
            {request.requested_item_thumbnail_url ? (
              <Text style={{ color: colors.muted }}>Tap image to preview.</Text>
            ) : null}
          </View>
        </View>
      ) : null}
      {request.picked_items.length > 0 ? (
        <View style={{ gap: 8 }}>
          {request.picked_items.map((pickedItem) => (
            <View
              key={pickedItem.id}
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 10, gap: 6, backgroundColor: colors.panelAlt }}
            >
              <Text style={{ color: colors.text, fontSize: 14, fontWeight: "700" }}>
                {pickedItem.item_name} ({pickedItem.item_code})
              </Text>
              <Text style={{ color: colors.muted }}>
                {pickedItem.item_category ?? "No category"} • {pickedItem.item_color ?? "No color"} • {pickedItem.item_room ?? "No room"}
              </Text>
              {pickedItem.notes ? <Text style={{ color: colors.muted }}>Pick notes: {pickedItem.notes}</Text> : null}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                <SecondaryButton disabled={saving} label="Open Picked Item" onPress={() => onOpenPickedItem(pickedItem.item_id)} />
                <SecondaryButton
                  disabled={saving || pickedItem.item_status !== "available"}
                  label={pickedItem.item_status === "available" ? "Assign to Project" : pickedItem.item_status === "on_job" ? "Already Assigned" : "Unavailable"}
                  onPress={() => onAssignPickedItem(pickedItem.item_id)}
                />
                <SecondaryButton disabled={saving} label="Remove Pick" onPress={() => onRemovePickedItem(pickedItem.id)} />
              </View>
            </View>
          ))}
        </View>
      ) : null}
      {request.active_job_names.length > 0 ? (
        <Text style={{ color: colors.errorText }}>Also on active jobs: {request.active_job_names.join(", ")}</Text>
      ) : null}
      {request.notes ? <Text style={{ color: colors.muted }}>Notes: {request.notes}</Text> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <SecondaryButton disabled={saving} label="Edit" onPress={onEdit} />
        <SecondaryButton disabled={saving} label={request.optional ? "Mark Required" : "Mark Optional"} onPress={onToggleOptional} />
        {request.requested_item_id ? <SecondaryButton disabled={saving} label="Open Exact Item" onPress={onOpenItem} /> : null}
        {onAssign ? <SecondaryButton disabled={saving || assignDisabled} label={assignLabel ?? "Assign to Project"} onPress={onAssign} /> : null}
        <SecondaryButton disabled={saving} label="Pick for Request" onPress={onStartPicking} />
        {onLogRequestedItem ? <SecondaryButton disabled={saving} label="Log Exact Item" onPress={onLogRequestedItem} /> : null}
        <SecondaryButton disabled={saving} label="Cancel" onPress={onCancel} />
        <SecondaryButton disabled={saving} label="Delete" onPress={onDelete} />
      </View>
    </View>
  );
}

function PickedItemCard({
  pickedItem,
  saving,
  onOpenItem,
  onAssign,
  onRemove,
}: {
  pickedItem: JobPickItem;
  saving: boolean;
  onOpenItem: () => void;
  onAssign: () => void;
  onRemove: () => void;
}) {
  return (
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 14, gap: 8, backgroundColor: colors.panel }}>
      <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>
        {pickedItem.item_name} ({pickedItem.item_code})
      </Text>
      <Text style={{ color: colors.muted }}>
        {pickedItem.item_category ?? "No category"} • {pickedItem.item_color ?? "No color"} • {pickedItem.item_room ?? "No room"}
      </Text>
      {pickedItem.notes ? <Text style={{ color: colors.muted }}>Pick notes: {pickedItem.notes}</Text> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <SecondaryButton disabled={saving} label="Open Item" onPress={onOpenItem} />
        <SecondaryButton
          disabled={saving || pickedItem.item_status !== "available"}
          label={pickedItem.item_status === "available" ? "Assign to Project" : pickedItem.item_status === "on_job" ? "Already Assigned" : "Unavailable"}
          onPress={onAssign}
        />
        <SecondaryButton disabled={saving} label="Remove Pick" onPress={onRemove} />
      </View>
    </View>
  );
}

export default function ProjectDetailScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const params = useLocalSearchParams<{ id: string }>();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const jobId = params.id;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [job, setJob] = useState<JobDetail | null>(null);
  const [assignments, setAssignments] = useState<JobAssignment[]>([]);
  const [packRequests, setPackRequests] = useState<JobPackRequest[]>([]);
  const [pickedItems, setPickedItems] = useState<JobPickItem[]>([]);
  const [sceneApplications, setSceneApplications] = useState<JobSceneApplication[]>([]);
  const [sceneTemplates, setSceneTemplates] = useState<SceneTemplate[]>([]);
  const [sceneRoomLabels, setSceneRoomLabels] = useState<Record<string, string>>({});
  const [sceneSourceRoom, setSceneSourceRoom] = useState("");
  const [newSceneName, setNewSceneName] = useState("");
  const [newSceneRoomType, setNewSceneRoomType] = useState("");
  const [newSceneStyleLabel, setNewSceneStyleLabel] = useState("");
  const [newSceneSummary, setNewSceneSummary] = useState("");
  const [newSceneNotes, setNewSceneNotes] = useState("");
  const [showEditProject, setShowEditProject] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectAddress1, setProjectAddress1] = useState("");
  const [projectAddress2, setProjectAddress2] = useState("");
  const [projectCity, setProjectCity] = useState("");
  const [projectState, setProjectState] = useState("");
  const [projectPostal, setProjectPostal] = useState("");
  const [projectNotes, setProjectNotes] = useState("");
  const [projectStatus, setProjectStatus] = useState("");
  const [packCandidates, setPackCandidates] = useState<InventoryPackCandidate[]>([]);
  const [requestText, setRequestText] = useState("");
  const [requestQuantity, setRequestQuantity] = useState("1");
  const [requestRoom, setRequestRoom] = useState("");
  const [requestCategory, setRequestCategory] = useState("");
  const [requestColor, setRequestColor] = useState("");
  const [requestNotes, setRequestNotes] = useState("");
  const [requestSearch, setRequestSearch] = useState("");
  const [selectedPackItemId, setSelectedPackItemId] = useState<string | null>(null);
  const [requestOptional, setRequestOptional] = useState(false);
  const [editingPackRequestId, setEditingPackRequestId] = useState<string | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState<string>("");
  const [previewZoom, setPreviewZoom] = useState(1);
  const [showAddPackList, setShowAddPackList] = useState(true);
  const [showQuickSelect, setShowQuickSelect] = useState(false);
  const [showSceneTemplates, setShowSceneTemplates] = useState(false);
  const [showAddPickList, setShowAddPickList] = useState(false);
  const [pickSearch, setPickSearch] = useState("");
  const [pickNotes, setPickNotes] = useState("");
  const [selectedPickItemIds, setSelectedPickItemIds] = useState<string[]>([]);
  const [activePickRequestId, setActivePickRequestId] = useState<string | null>(null);
  const [pickAvailabilityFilter, setPickAvailabilityFilter] = useState<"all" | "available" | "on_job" | "unavailable">("all");
  const [pickLocationFilter, setPickLocationFilter] = useState("all");

  const refreshJob = useCallback(async () => {
    if (!jobId) {
      return;
    }

    const [detail, nextPackCandidates, nextSceneTemplates] = await Promise.all([
      getJobDetail(jobId),
      listPackListInventoryItems(),
      listSceneTemplates(),
    ]);
    setJob(detail.job);
    setAssignments(detail.assignments);
    setPackRequests(detail.packRequests);
    setPickedItems(detail.pickedItems);
    setSceneApplications(detail.sceneApplications);
    setPackCandidates(nextPackCandidates);
    setSceneTemplates(nextSceneTemplates);
    setSceneRoomLabels((current) => {
      const nextLabels = { ...current };
      for (const template of nextSceneTemplates) {
        if (!nextLabels[template.id]) {
          nextLabels[template.id] = template.room_type ?? "";
        }
      }
      return nextLabels;
    });
    setSceneSourceRoom((current) => {
      if (current) {
        return current;
      }

      const firstNamedRoom =
        detail.packRequests.find((request) => Boolean(request.room && request.room.trim()))?.room?.trim() ?? "";
      return firstNamedRoom;
    });
    setNewSceneRoomType((current) => {
      if (current.trim()) {
        return current;
      }

      return detail.packRequests.find((request) => Boolean(request.room && request.room.trim()))?.room?.trim() ?? current;
    });
  }, [jobId]);

  useEffect(() => {
    void refreshJob()
      .catch((error) => setMessage(error instanceof Error ? error.message : "Failed to load project."))
      .finally(() => setLoading(false));
  }, [refreshJob]);

  useFocusEffect(
    useCallback(() => {
      void refreshJob();
    }, [refreshJob]),
  );

  const activeAssignments = useMemo(() => assignments.filter((assignment) => !assignment.checked_in_at), [assignments]);
  const completedAssignments = useMemo(() => assignments.filter((assignment) => assignment.checked_in_at), [assignments]);
  const activeAssignedItemIds = useMemo(() => new Set(activeAssignments.map((assignment) => assignment.item_id)), [activeAssignments]);
  const openPackRequests = useMemo(() => packRequests.filter((request) => request.status !== "cancelled"), [packRequests]);
  const fulfilledRequestCount = useMemo(() => openPackRequests.filter((request) => request.picked_count >= request.quantity).length, [openPackRequests]);
  const openPackRequestsByRoom = useMemo(() => {
    const groups = openPackRequests.reduce<Record<string, JobPackRequest[]>>((acc, request) => {
      const key = (request.room ?? "").trim() || "No room";
      acc[key] = [...(acc[key] ?? []), request];
      return acc;
    }, {});

    return Object.entries(groups).sort(([a], [b]) => {
      if (a === "No room") return 1;
      if (b === "No room") return -1;
      return a.localeCompare(b);
    });
  }, [openPackRequests]);
  const projectLocation = useMemo(
    () => formatProjectAddress(job ?? {}),
    [job],
  );
  const projectSubtitle = useMemo(() => (job ? [projectLocation, job.status].filter(Boolean).join(" • ") : "Loading project detail"), [job, projectLocation]);
  const extraPickedItems = useMemo(() => pickedItems.filter((pickedItem) => !pickedItem.pack_request_id), [pickedItems]);
  const pickedItemIds = useMemo(() => new Set(pickedItems.map((pickedItem) => pickedItem.item_id)), [pickedItems]);
  const activePickRequest = useMemo(
    () => openPackRequests.find((request) => request.id === activePickRequestId) ?? null,
    [activePickRequestId, openPackRequests],
  );
  const editingPackRequest = useMemo(
    () => openPackRequests.find((request) => request.id === editingPackRequestId) ?? null,
    [editingPackRequestId, openPackRequests],
  );
  const isEditingPackRequest = editingPackRequestId !== null;
  const linkedRequestedItemIds = useMemo(
    () =>
      new Set(
        openPackRequests
          .map((request) => request.requested_item_id)
          .filter((value): value is string => Boolean(value && value !== editingPackRequest?.requested_item_id)),
      ),
    [editingPackRequest?.requested_item_id, openPackRequests],
  );
  const appliedSceneCountByTemplateId = useMemo(
    () =>
      sceneApplications.reduce<Record<string, number>>((acc, application) => {
        acc[application.scene_template_id] = (acc[application.scene_template_id] ?? 0) + 1;
        return acc;
      }, {}),
    [sceneApplications],
  );
  const authorableRooms = useMemo(
    () => openPackRequestsByRoom.filter(([roomLabel]) => roomLabel !== "No room"),
    [openPackRequestsByRoom],
  );
  const selectedSourceRoomRequestCount = useMemo(
    () => authorableRooms.find(([roomLabel]) => roomLabel === sceneSourceRoom)?.[1].length ?? 0,
    [authorableRooms, sceneSourceRoom],
  );
  const filteredPackCandidates = useMemo(() => {
    const query = normalize(requestSearch);
    if (!query) {
      return [];
    }

    return packCandidates
      .filter((candidate) => {
        if (linkedRequestedItemIds.has(candidate.id) && candidate.id !== selectedPackItemId) {
          return false;
        }

        const haystack = [candidate.name, candidate.item_code, candidate.category, candidate.color, candidate.room, candidate.status].map(normalize).join(" ");
        return haystack.includes(query);
      })
      .sort((a, b) => {
        const aCode = normalize(a.item_code);
        const bCode = normalize(b.item_code);
        const aName = normalize(a.name);
        const bName = normalize(b.name);
        const aStarts = Number(aCode.startsWith(query) || aName.startsWith(query));
        const bStarts = Number(bCode.startsWith(query) || bName.startsWith(query));
        if (aStarts !== bStarts) {
          return bStarts - aStarts;
        }

        return aName.localeCompare(bName);
      });
  }, [linkedRequestedItemIds, packCandidates, requestSearch, selectedPackItemId]);
  const visiblePackCandidates = useMemo(() => filteredPackCandidates.slice(0, 100), [filteredPackCandidates]);
  const quickSelectLocationOptions = useMemo(
    () =>
      [...new Set(packCandidates.map((candidate) => candidate.current_location_name).filter((value): value is string => Boolean(value)))]
        .sort((a, b) => a.localeCompare(b)),
    [packCandidates],
  );
  const filteredPickCandidates = useMemo(() => {
    const query = normalize(pickSearch);
    return packCandidates
      .filter((candidate) => {
        if (pickedItemIds.has(candidate.id) && !selectedPickItemIds.includes(candidate.id)) {
          return false;
        }

        if (pickAvailabilityFilter === "available" && candidate.status !== "available") {
          return false;
        }

        if (pickAvailabilityFilter === "on_job" && candidate.status !== "on_job") {
          return false;
        }

        if (pickAvailabilityFilter === "unavailable" && (candidate.status === "available" || candidate.status === "on_job")) {
          return false;
        }

        if (pickLocationFilter !== "all" && (candidate.current_location_name ?? "") !== pickLocationFilter) {
          return false;
        }

        const haystack = [candidate.name, candidate.item_code, candidate.category, candidate.color, candidate.room, candidate.status].map(normalize).join(" ");
        return query ? haystack.includes(query) : true;
      })
      .sort((a, b) => normalize(a.name).localeCompare(normalize(b.name)));
  }, [packCandidates, pickAvailabilityFilter, pickLocationFilter, pickSearch, pickedItemIds, selectedPickItemIds]);
  const previewImageWidth = Math.max(windowWidth - 40, 280) * previewZoom;
  const previewImageHeight = Math.max(windowHeight * 0.68, 360) * previewZoom;
  const packRequestDirty = useMemo(() => {
    if (!editingPackRequest) {
      return true;
    }

    const quantity = Number.parseInt(requestQuantity, 10);
    const selectedPackItem = selectedPackItemId ? packCandidates.find((candidate) => candidate.id === selectedPackItemId) ?? null : null;
    const resolvedText = requestText.trim() || (selectedPackItem?.name ?? "");
    const resolvedCategory = requestCategory || selectedPackItem?.category || "";
    const resolvedColor = requestColor || selectedPackItem?.color || "";

    return (
      resolvedText !== editingPackRequest.request_text ||
      quantity !== editingPackRequest.quantity ||
      (requestRoom || "") !== (editingPackRequest.room ?? "") ||
      resolvedCategory !== (editingPackRequest.category ?? "") ||
      resolvedColor !== (editingPackRequest.color ?? "") ||
      (requestNotes || "") !== (editingPackRequest.notes ?? "") ||
      requestOptional !== editingPackRequest.optional ||
      (selectedPackItemId ?? null) !== (editingPackRequest.requested_item_id ?? null)
    );
  }, [
    editingPackRequest,
    packCandidates,
    requestCategory,
    requestColor,
    requestNotes,
    requestOptional,
    requestQuantity,
    requestRoom,
    requestText,
    selectedPackItemId,
  ]);
  const projectDirty = useMemo(() => {
    if (!job) {
      return false;
    }

    return (
      projectName.trim() !== job.name ||
      projectAddress1.trim() !== (job.address1 ?? "") ||
      projectAddress2.trim() !== (job.address2 ?? "") ||
      projectCity.trim() !== (job.city ?? "") ||
      projectState.trim() !== (job.state ?? "") ||
      projectPostal.trim() !== (job.postal ?? "") ||
      projectNotes.trim() !== (job.notes ?? "") ||
      projectStatus.trim() !== job.status
    );
  }, [job, projectAddress1, projectAddress2, projectCity, projectName, projectNotes, projectPostal, projectState, projectStatus]);

  const syncProjectForm = useCallback((source: JobDetail) => {
    setProjectName(source.name);
    setProjectAddress1(source.address1 ?? "");
    setProjectAddress2(source.address2 ?? "");
    setProjectCity(source.city ?? "");
    setProjectState(source.state ?? "");
    setProjectPostal(source.postal ?? "");
    setProjectNotes(source.notes ?? "");
    setProjectStatus(source.status);
  }, []);

  useEffect(() => {
    if (!job || showEditProject) {
      return;
    }

    syncProjectForm(job);
  }, [job, showEditProject, syncProjectForm]);

  function resetPackRequestForm() {
    setEditingPackRequestId(null);
    setRequestText("");
    setRequestQuantity("1");
    setRequestRoom("");
    setRequestCategory("");
    setRequestColor("");
    setRequestNotes("");
    setRequestSearch("");
    setSelectedPackItemId(null);
    setRequestOptional(false);
  }

  function resetSceneAuthoringForm() {
    setNewSceneName("");
    setNewSceneRoomType(sceneSourceRoom);
    setNewSceneStyleLabel("");
    setNewSceneSummary("");
    setNewSceneNotes("");
  }

  const createBulkRequestLabel = useCallback(
    () => buildBulkPackRequestLabel(session),
    [session],
  );

  function resetPickForm(nextActivePickRequestId: string | null = activePickRequestId) {
    setPickSearch("");
    setPickNotes(nextActivePickRequestId ? "" : createBulkRequestLabel());
    setSelectedPickItemIds([]);
    setPickAvailabilityFilter("all");
    setPickLocationFilter("all");
  }

  function handleStartQuickSelect(nextRequestId: string | null) {
    setActivePickRequestId(nextRequestId);
    setShowAddPickList(true);
    resetPickForm(nextRequestId);
  }

  function handleStartEditProject() {
    if (!job) {
      return;
    }

    syncProjectForm(job);
    setShowEditProject(true);
  }

  function handleCancelEditProject() {
    if (job) {
      syncProjectForm(job);
    }

    setShowEditProject(false);
  }

  function handleEditPackRequest(request: JobPackRequest) {
    setEditingPackRequestId(request.id);
    setRequestText(request.request_text);
    setRequestQuantity(String(request.quantity));
    setRequestRoom(request.room ?? "");
    setRequestCategory(request.category ?? "");
    setRequestColor(request.color ?? "");
    setRequestNotes(request.notes ?? "");
    setSelectedPackItemId(request.requested_item_id);
    setRequestOptional(request.optional);
    setRequestSearch(request.requested_item_name ?? request.requested_item_code ?? request.request_text);
  }

  function handleOpenPreview(imageUrl: string | null, title: string) {
    if (!imageUrl) {
      return;
    }

    setPreviewZoom(1);
    setPreviewImageUrl(imageUrl);
    setPreviewTitle(title);
  }

  function handleClosePreview() {
    setPreviewImageUrl(null);
    setPreviewTitle("");
    setPreviewZoom(1);
  }

  function openInventoryItem(itemId: string) {
    if (!jobId) {
      return;
    }

    router.push({
      pathname: "/inventory/[id]",
      params: {
        id: itemId,
        returnPath: `/projects/${jobId}`,
        returnLabel: "Back to Project",
      },
    });
  }

  async function handleCheckIn(jobItemId: string) {
    setSaving(true);
    setMessage(null);
    try {
      await checkInJobItem(jobItemId);
      await refreshJob();
      setMessage("Item checked in.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to check in item.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAssignRequestedItem(itemId: string) {
    if (!jobId) {
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      await assignItemToJob(jobId, itemId);
      await refreshJob();
      setMessage("Item assigned.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to assign item.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAssignPickedItem(itemId: string) {
    if (!jobId) {
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      await assignItemToJob(jobId, itemId);
      await refreshJob();
      setMessage("Item assigned.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to assign item.");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateProject() {
    if (!jobId) {
      return;
    }

    if (!projectName.trim()) {
      setMessage("Project name is required.");
      return;
    }

    if (!projectStatus.trim()) {
      setMessage("Project status is required.");
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      await updateJob({
        jobId,
        name: projectName,
        address1: projectAddress1,
        address2: projectAddress2,
        city: projectCity,
        state: projectState,
        postal: projectPostal,
        notes: projectNotes,
        status: projectStatus,
      });
      await refreshJob();
      setShowEditProject(false);
      setMessage("Project updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to update project.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateOrUpdatePackRequest() {
    if (!jobId) {
      return;
    }

    const quantity = Number.parseInt(requestQuantity, 10);
    const selectedPackItem = selectedPackItemId ? packCandidates.find((candidate) => candidate.id === selectedPackItemId) ?? null : null;
    const resolvedText = requestText.trim() || (selectedPackItem?.name ?? "");

    if (!resolvedText) {
      setMessage("Add a request description or choose an inventory item.");
      return;
    }

    if (!Number.isFinite(quantity) || quantity < 1) {
      setMessage("Quantity must be at least 1.");
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      if (editingPackRequestId) {
        await updatePackRequest({
          packRequestId: editingPackRequestId,
          requestText: resolvedText,
          quantity,
          room: requestRoom,
          category: requestCategory || selectedPackItem?.category || "",
          color: requestColor || selectedPackItem?.color || "",
          notes: requestNotes,
          optional: requestOptional,
          requestedItemId: selectedPackItemId,
        });
      } else {
        await createPackRequest({
          jobId,
          requestText: resolvedText,
          quantity,
          room: requestRoom,
          category: requestCategory || selectedPackItem?.category || "",
          color: requestColor || selectedPackItem?.color || "",
          notes: requestNotes,
          optional: requestOptional,
          requestedItemId: selectedPackItemId,
        });
      }
      await refreshJob();
      resetPackRequestForm();
      setShowAddPackList(false);
      setMessage(editingPackRequestId ? "Pack request updated." : "Pack request added.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : editingPackRequestId ? "Failed to update pack request." : "Failed to add pack request.");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdatePackRequest(packRequestId: string, status: "requested" | "packed" | "cancelled") {
    setSaving(true);
    setMessage(null);
    try {
      await updatePackRequestStatus(packRequestId, status);
      await refreshJob();
      setMessage(status === "packed" ? "Pack request marked packed." : "Pack request updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to update pack request.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreatePickItem() {
    if (!jobId || selectedPickItemIds.length === 0) {
      setMessage("Choose at least one inventory item to log.");
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const resolvedNotes = pickNotes.trim() || (!activePickRequestId ? createBulkRequestLabel() : "");
      let resolvedPackRequestId = activePickRequestId;

      if (!resolvedPackRequestId) {
        resolvedPackRequestId = await createPackRequest({
          jobId,
          requestText: resolvedNotes,
          quantity: selectedPickItemIds.length,
          room: "",
          category: "",
          color: "",
          notes: resolvedNotes,
          optional: false,
          requestedItemId: null,
        });
      }

      const failures: string[] = [];
      let successCount = 0;

      for (const itemId of selectedPickItemIds) {
        try {
          await createJobPickItem({
            jobId,
            itemId,
            packRequestId: resolvedPackRequestId,
            notes: resolvedNotes,
          });
          successCount += 1;
        } catch (error) {
          failures.push(error instanceof Error ? error.message : `Failed to log item ${itemId}.`);
        }
      }

      await refreshJob();
      resetPickForm(activePickRequestId);
      setShowAddPickList(false);
      if (failures.length > 0) {
        setMessage(`Logged ${successCount} item${successCount === 1 ? "" : "s"}. ${failures[0]}`);
      } else {
        setMessage(activePickRequestId ? `Logged ${successCount} quick select item${successCount === 1 ? "" : "s"} for request.` : `Created bulk pack request with ${successCount} item${successCount === 1 ? "" : "s"}.`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to log quick select items.");
    } finally {
      setSaving(false);
    }
  }

  async function handleLogRequestedExactItem(request: JobPackRequest) {
    if (!jobId || !request.requested_item_id) {
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      await createJobPickItem({
        jobId,
        itemId: request.requested_item_id,
        packRequestId: request.id,
      });
      await refreshJob();
      setMessage("Exact request item logged.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to log exact item.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePickItem(jobPickItemId: string) {
    setSaving(true);
    setMessage(null);
    try {
      await deleteJobPickItem(jobPickItemId);
      await refreshJob();
      setMessage("Exact project item removed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to remove exact item.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePackRequest(packRequestId: string) {
    setSaving(true);
    setMessage(null);
    try {
      await deletePackRequest(packRequestId);
      await refreshJob();
      setMessage("Pack request removed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to remove pack request.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleOptional(request: JobPackRequest) {
    setSaving(true);
    setMessage(null);
    try {
      await updatePackRequest({
        packRequestId: request.id,
        requestText: request.request_text,
        quantity: request.quantity,
        room: request.room ?? "",
        category: request.category ?? "",
        color: request.color ?? "",
        notes: request.notes ?? "",
        optional: !request.optional,
        requestedItemId: request.requested_item_id,
      });
      await refreshJob();
      setMessage(`Pack request marked ${request.optional ? "required" : "optional"}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to update pack request.");
    } finally {
      setSaving(false);
    }
  }

  async function handleApplySceneTemplate(template: SceneTemplate) {
    if (!jobId) {
      return;
    }

    const roomLabel = (sceneRoomLabels[template.id] ?? "").trim() || template.room_type?.trim() || template.name;
    if (!roomLabel) {
      setMessage("Add a room label before applying a scene.");
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      await applySceneTemplateToJob({
        jobId,
        sceneTemplateId: template.id,
        roomLabel,
      });
      await refreshJob();
      setMessage(`${template.name} added to the pack list for ${roomLabel}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to apply scene template.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteSceneApplication(application: JobSceneApplication) {
    setSaving(true);
    setMessage(null);
    try {
      await deleteSceneApplication(application.id);
      await refreshJob();
      setMessage(`${application.scene_template_name} removed from this project.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to remove scene application.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateSceneTemplateFromRoom() {
    if (!jobId) {
      return;
    }

    if (!sceneSourceRoom.trim()) {
      setMessage("Choose a project room to save as a reusable scene.");
      return;
    }

    if (!newSceneName.trim()) {
      setMessage("Scene template name is required.");
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const result = await createSceneTemplateFromJobRoom({
        jobId,
        sourceRoom: sceneSourceRoom,
        name: newSceneName,
        roomType: newSceneRoomType || sceneSourceRoom,
        styleLabel: newSceneStyleLabel,
        summary: newSceneSummary,
        notes: newSceneNotes,
      });
      await refreshJob();
      resetSceneAuthoringForm();
      setMessage(`Saved ${result.sceneName} with ${result.itemCount} room request${result.itemCount === 1 ? "" : "s"}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save room as a reusable scene.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppScreen>
      <Hero
        eyebrow="Project"
        title={job?.name ?? "Project detail"}
        subtitle={projectSubtitle}
        right={job ? <SecondaryButton label={showEditProject ? "Hide Edit" : "Edit Details"} onPress={showEditProject ? handleCancelEditProject : handleStartEditProject} /> : null}
      />
      <SecondaryButton label="Back to Projects" onPress={() => router.replace("/projects")} />
      {loading ? <LoadingState label="Loading project..." /> : null}
      {message ? (
        <Message
          text={message}
          tone={
            message === "Item assigned." ||
            message === "Item checked in." ||
            message === "Pack request added." ||
            message === "Pack request marked optional." ||
            message === "Pack request marked required." ||
            message === "Project updated." ||
            message === "Pack request updated." ||
            message === "Pack request removed." ||
            message === "Exact item logged for request." ||
            message === "Exact request item logged." ||
            message === "Exact project item removed." ||
            message?.includes("added to the pack list for") ||
            message?.includes("removed from this project.") ||
            message?.startsWith("Saved ") ||
            message.startsWith("Logged ") ||
            message.startsWith("Created bulk pack request")
              ? "success"
              : "error"
          }
        />
      ) : null}
      {!loading ? (
        <>
          {showEditProject ? (
            <Card>
              <SectionTitle>Edit Project Details</SectionTitle>
              <Field label="Client / Project Name" onChangeText={setProjectName} value={projectName} />
              <Field label="Street Address" onChangeText={setProjectAddress1} value={projectAddress1} />
              <Field label="Address Line 2" onChangeText={setProjectAddress2} value={projectAddress2} />
              <View style={{ flexDirection: "row", gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Field label="City" onChangeText={setProjectCity} value={projectCity} />
                </View>
                <View style={{ flex: 1 }}>
                  <Field label="State" onChangeText={setProjectState} value={projectState} />
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Field label="Postal Code" onChangeText={setProjectPostal} value={projectPostal} />
                </View>
              </View>
              <Field label="Status" onChangeText={setProjectStatus} value={projectStatus} />
              <Text style={{ color: colors.muted }}>
                {projectLocation ? `Map address: ${projectLocation}, US` : "Add a full address so this project can be pinned on a map later."}
              </Text>
              <Text style={{ color: colors.muted }}>
                {job?.latitude != null && job.longitude != null ? `Stored coordinates: ${job.latitude.toFixed(5)}, ${job.longitude.toFixed(5)}` : "Coordinates not stored yet."}
              </Text>
              <Field label="Notes" multiline onChangeText={setProjectNotes} value={projectNotes} />
              <View style={{ flexDirection: "row", gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <PrimaryButton disabled={saving || !projectDirty} label={saving ? "Saving..." : "Save Project Details"} onPress={() => void handleUpdateProject()} />
                </View>
                <View style={{ flex: 1 }}>
                  <SecondaryButton disabled={saving} label="Cancel" onPress={handleCancelEditProject} />
                </View>
              </View>
            </Card>
          ) : null}

          <Card>
            <SectionTitle>Pack List</SectionTitle>
            <Text style={{ color: colors.muted }}>
              {openPackRequests.length} requests total • {fulfilledRequestCount} fully covered • {pickedItems.length} exact items logged for this project
            </Text>
            <Text style={{ color: colors.muted }}>
              Pack requests describe designer intent. Exact picks describe what you actually loaded or left at the house.
            </Text>
            <Text style={{ color: colors.muted }}>
              {sceneApplications.length} applied scene{sceneApplications.length === 1 ? "" : "s"} are currently feeding this room-by-room pack list.
            </Text>
          </Card>

          <Card>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>Add to Pack List</Text>
              <SecondaryButton label={showAddPackList ? "Hide Form" : "Add to Pack List"} onPress={() => setShowAddPackList((current) => !current)} />
            </View>
            {showAddPackList ? (
              <>
                <Field label="Request" onChangeText={setRequestText} placeholder="4 blue pillows, 1 ladder, dining table art..." value={requestText} />
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Field label="Quantity" keyboardType="numeric" onChangeText={setRequestQuantity} value={requestQuantity} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field label="Room" onChangeText={setRequestRoom} value={requestRoom} />
                  </View>
                </View>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Field label="Category" onChangeText={setRequestCategory} value={requestCategory} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field label="Color" onChangeText={setRequestColor} value={requestColor} />
                  </View>
                </View>
                <Field label="Notes" multiline onChangeText={setRequestNotes} placeholder="Optional styling notes, alternates, or client preferences." value={requestNotes} />
                <SecondaryButton label={requestOptional ? "Optional item selected" : "Mark as Optional"} onPress={() => setRequestOptional((current) => !current)} />
                <Field label="Link exact inventory item" onChangeText={setRequestSearch} placeholder="Search by item code, name, category, color..." value={requestSearch} />
                {!requestSearch.trim() ? (
                  <Text style={{ color: colors.muted }}>Start typing to search the full inventory by name, item code, category, room, or color.</Text>
                ) : (
                  <Card>
                    <Text style={{ color: colors.text, fontSize: 15, fontWeight: "700" }}>
                      {filteredPackCandidates.length} matching items
                    </Text>
                    <Text style={{ color: colors.muted }}>
                      {filteredPackCandidates.length > visiblePackCandidates.length
                        ? `Showing the first ${visiblePackCandidates.length}. Refine the search to narrow it down.`
                        : "Showing all current matches."}
                    </Text>
                  </Card>
                )}
                <View style={{ gap: 10 }}>
                  {visiblePackCandidates.map((item) => (
                    <Card key={item.id}>
                      <Text style={{ color: colors.text, fontSize: 15, fontWeight: "700" }}>{item.name}</Text>
                      <Text style={{ color: colors.muted }}>{item.item_code}</Text>
                      <Text style={{ color: colors.muted }}>
                        {item.category ?? "No category"} • {item.color ?? "No color"} • {item.current_location_name ?? "No location"}
                      </Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                        <SecondaryButton
                          label={selectedPackItemId === item.id ? "Selected" : "Select Item"}
                          onPress={() => setSelectedPackItemId((current) => (current === item.id ? null : item.id))}
                        />
                        <SecondaryButton label="Open Item" onPress={() => openInventoryItem(item.id)} />
                        {item.thumbnail_url ? (
                          <SecondaryButton label="Preview" onPress={() => handleOpenPreview(item.thumbnail_url, `${item.name} (${item.item_code})`)} />
                        ) : null}
                      </View>
                    </Card>
                  ))}
                </View>
                <PrimaryButton
                  disabled={saving}
                  label={saving ? "Working..." : "Add Pack Request"}
                  onPress={() => void handleCreateOrUpdatePackRequest()}
                />
                <Text style={{ color: colors.muted }}>
                  Use Edit on an existing request to change it without losing your place on this page.
                </Text>
              </>
            ) : (
              <Text style={{ color: colors.muted }}>
                Expand this section when you want to add another pack request or link an exact inventory item.
              </Text>
            )}
          </Card>

          <Card>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>Quick Select</Text>
              <SecondaryButton label={showQuickSelect ? "Hide Quick Select" : "Open Quick Select"} onPress={() => setShowQuickSelect((current) => !current)} />
            </View>
            {showQuickSelect ? (
              <>
                <Text style={{ color: colors.muted }}>
                  Select multiple thumbnail items at once. If you are not working from an existing pack request, Quick Select will create a grouped bulk pack request automatically.
                </Text>
                <Card>
                  <Text style={{ color: colors.text, fontSize: 15, fontWeight: "700" }}>
                    {activePickRequest ? `Logging for: ${activePickRequest.request_text}` : "Creating a generated bulk pack request"}
                  </Text>
                  <Text style={{ color: colors.muted }}>
                    {activePickRequest
                      ? `This request has ${activePickRequest.picked_count} of ${activePickRequest.quantity} exact picks logged.`
                      : "Selected items will be grouped under a generated bulk pack request so they stay linked together."}
                  </Text>
                  <Text style={{ color: colors.muted }}>
                    {selectedPickItemIds.length === 0
                      ? "No items selected yet. Open the modal to search and multi-select from thumbnails."
                      : `${selectedPickItemIds.length} item${selectedPickItemIds.length === 1 ? "" : "s"} selected. Open the modal to review or change the set.`}
                  </Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {activePickRequest ? <SecondaryButton label="Use Generated Bulk Request" onPress={() => handleStartQuickSelect(null)} /> : null}
                    <SecondaryButton label="Find and Select Items" onPress={() => setShowAddPickList(true)} />
                  </View>
                </Card>
                <Field label="Pick notes" multiline onChangeText={setPickNotes} placeholder="Optional notes about why these items satisfied the request." value={pickNotes} />
                <PrimaryButton
                  disabled={saving}
                  label={saving ? "Working..." : activePickRequest ? "Log Quick Select for Request" : "Create Bulk Pack Request"}
                  onPress={() => void handleCreatePickItem()}
                />
              </>
            ) : (
              <Text style={{ color: colors.muted }}>
                Expand this section when you want to multi-select thumbnail items or build a generated bulk pack request.
              </Text>
            )}
          </Card>

          <Card>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>Scene Templates</Text>
              <SecondaryButton
                label={showSceneTemplates ? "Hide Scene Templates" : "Open Scene Templates"}
                onPress={() => setShowSceneTemplates((current) => !current)}
              />
            </View>
            {showSceneTemplates ? (
              <>
                <Text style={{ color: colors.muted }}>
                  Use reusable room recipes to generate grouped pack requests from staging patterns you repeat often.
                </Text>
                {sceneApplications.length > 0 ? (
                  <View style={{ gap: 10 }}>
                    {sceneApplications.map((application) => (
                      <View
                        key={application.id}
                        style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 14, gap: 6, backgroundColor: colors.panelAlt }}
                      >
                        <Text style={{ color: colors.text, fontSize: 15, fontWeight: "700" }}>
                          {application.scene_template_name} for {application.room_label}
                        </Text>
                        <Text style={{ color: colors.muted }}>
                          {application.pack_request_count} requests • {application.fulfilled_request_count} fully covered
                        </Text>
                        {application.notes ? <Text style={{ color: colors.muted }}>Notes: {application.notes}</Text> : null}
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                          <SecondaryButton disabled={saving} label="Remove Scene" onPress={() => void handleDeleteSceneApplication(application)} />
                        </View>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={{ color: colors.muted }}>No reusable scenes applied yet.</Text>
                )}
                <View style={{ gap: 12 }}>
                  {sceneTemplates.map((template) => (
                    <View
                      key={template.id}
                      style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 14, gap: 10, backgroundColor: colors.panel }}
                    >
                      <View style={{ gap: 4 }}>
                        <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>{template.name}</Text>
                        <Text style={{ color: colors.muted }}>
                          {template.room_type ?? "Room"} • {template.style_label ?? "General"} • {template.item_count} template item{template.item_count === 1 ? "" : "s"}
                        </Text>
                        {template.summary ? <Text style={{ color: colors.muted }}>{template.summary}</Text> : null}
                        {(appliedSceneCountByTemplateId[template.id] ?? 0) > 0 ? (
                          <Text style={{ color: colors.muted }}>
                            Applied {appliedSceneCountByTemplateId[template.id]} time{appliedSceneCountByTemplateId[template.id] === 1 ? "" : "s"} on this project.
                          </Text>
                        ) : null}
                      </View>
                      <View style={{ gap: 6 }}>
                        {template.items.map((item) => (
                          <Text key={item.id} style={{ color: colors.muted }}>
                            {item.quantity} x {item.request_text}
                            {item.category ? ` • ${item.category}` : ""}
                            {item.color ? ` • ${item.color}` : ""}
                            {item.optional ? " • optional" : ""}
                          </Text>
                        ))}
                      </View>
                      <Field
                        label="Apply as room"
                        onChangeText={(value) => setSceneRoomLabels((current) => ({ ...current, [template.id]: value }))}
                        value={sceneRoomLabels[template.id] ?? ""}
                      />
                      <PrimaryButton disabled={saving} label={saving ? "Working..." : "Apply Scene to Project"} onPress={() => void handleApplySceneTemplate(template)} />
                    </View>
                  ))}
                </View>
                <View style={{ gap: 10 }}>
                  <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>Save Current Room as Scene</Text>
                  <Text style={{ color: colors.muted }}>
                    Snapshot a room&apos;s current pack requests into a reusable scene template so future projects can start from the same recipe.
                  </Text>
                  {authorableRooms.length === 0 ? (
                    <Text style={{ color: colors.muted }}>Add pack requests to a named room first, then save that room as a reusable scene.</Text>
                  ) : (
                    <>
                      <Field
                        label="Source room"
                        onChangeText={(value) => {
                          setSceneSourceRoom(value);
                          if (!newSceneRoomType.trim()) {
                            setNewSceneRoomType(value);
                          }
                        }}
                        placeholder={authorableRooms.map(([roomLabel]) => roomLabel).join(", ")}
                        value={sceneSourceRoom}
                      />
                      <Text style={{ color: colors.muted }}>
                        {selectedSourceRoomRequestCount > 0
                          ? `${selectedSourceRoomRequestCount} active pack request${selectedSourceRoomRequestCount === 1 ? "" : "s"} will be saved from this room.`
                          : "Type a room name exactly as it appears in the pack list."}
                      </Text>
                      <Field label="Scene template name" onChangeText={setNewSceneName} placeholder="Organic primary bedroom" value={newSceneName} />
                      <View style={{ flexDirection: "row", gap: 12 }}>
                        <View style={{ flex: 1 }}>
                          <Field label="Room type" onChangeText={setNewSceneRoomType} placeholder="Primary Bedroom" value={newSceneRoomType} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Field label="Style label" onChangeText={setNewSceneStyleLabel} placeholder="Soft organic" value={newSceneStyleLabel} />
                        </View>
                      </View>
                      <Field label="Summary" multiline onChangeText={setNewSceneSummary} placeholder="Short note about what defines this setup." value={newSceneSummary} />
                      <Field label="Template notes" multiline onChangeText={setNewSceneNotes} placeholder="Anything worth remembering when this scene is reused." value={newSceneNotes} />
                      <PrimaryButton disabled={saving} label={saving ? "Working..." : "Save Room as New Scene"} onPress={() => void handleCreateSceneTemplateFromRoom()} />
                    </>
                  )}
                </View>
              </>
            ) : (
              <Text style={{ color: colors.muted }}>
                Expand this section when you want to apply reusable room recipes or save a room as a scene.
              </Text>
            )}
          </Card>

          <Card>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>Pack Requests</Text>
            {openPackRequests.length === 0 ? (
              <EmptyState title="No pack requests yet." body="Use this list for designer asks like mirrors, pillows, or kitchen knick-knacks." />
            ) : (
              openPackRequestsByRoom.map(([roomLabel, requests]) => (
                <View key={roomLabel} style={{ gap: 10 }}>
                  <Text style={{ color: colors.text, fontSize: 15, fontWeight: "700" }}>
                    {roomLabel} ({requests.length})
                  </Text>
                  {requests.map((request) => (
                    <PackRequestCard
                      key={request.id}
                      request={request}
                      saving={saving}
                      onEdit={() => handleEditPackRequest(request)}
                      onToggleOptional={() => void handleToggleOptional(request)}
                      onOpenItem={() => request.requested_item_id ? openInventoryItem(request.requested_item_id) : undefined}
                      onPreview={() => handleOpenPreview(request.requested_item_thumbnail_url, `${request.requested_item_name} (${request.requested_item_code})`)}
                      onStartPicking={() => handleStartQuickSelect(request.id)}
                      onLogRequestedItem={request.requested_item_id ? () => void handleLogRequestedExactItem(request) : undefined}
                      onOpenPickedItem={(pickedItemId) => openInventoryItem(pickedItemId)}
                      onAssignPickedItem={(pickedItemId) => void handleAssignPickedItem(pickedItemId)}
                      onRemovePickedItem={(jobPickItemId) => void handleDeletePickItem(jobPickItemId)}
                      onAssign={request.requested_item_id ? () => void handleAssignRequestedItem(request.requested_item_id!) : undefined}
                      assignDisabled={!request.requested_item_id || activeAssignedItemIds.has(request.requested_item_id) || request.requested_item_status !== "available"}
                      assignLabel={
                        activeAssignedItemIds.has(request.requested_item_id ?? "")
                          ? "Already Assigned"
                          : request.requested_item_status !== "available"
                            ? "Unavailable"
                            : "Assign to Project"
                      }
                      onCancel={() => void handleUpdatePackRequest(request.id, "cancelled")}
                      onDelete={() => void handleDeletePackRequest(request.id)}
                    />
                  ))}
                </View>
              ))
            )}
          </Card>

          <Card>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>Extra Items at House</Text>
            <Text style={{ color: colors.muted }}>
              These are legacy exact items logged for the project without a matching pack request.
            </Text>
            {extraPickedItems.length === 0 ? (
              <EmptyState title="No unlinked items logged." body="New quick-select entries are grouped into generated bulk pack requests instead of being left unlinked." />
            ) : (
              extraPickedItems.map((pickedItem) => (
                <PickedItemCard
                  key={pickedItem.id}
                  pickedItem={pickedItem}
                  saving={saving}
                  onOpenItem={() => openInventoryItem(pickedItem.item_id)}
                  onAssign={() => void handleAssignPickedItem(pickedItem.item_id)}
                  onRemove={() => void handleDeletePickItem(pickedItem.id)}
                />
              ))
            )}
          </Card>

          <Card>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>Currently Assigned</Text>
            <Text style={{ color: colors.muted }}>
              These items are currently checked out to this project. Use Check In when the item physically returns from the house or stage.
            </Text>
            {activeAssignments.length === 0 ? (
              <EmptyState title="No active assignments." body="Items assigned to this house will appear here with check-in controls." />
            ) : (
              activeAssignments.map((assignment) => (
                <View
                  key={assignment.id}
                  style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 14, gap: 6, backgroundColor: colors.panel }}
                >
                  <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>
                    {assignment.item_name} ({assignment.item_code})
                  </Text>
                  <Text style={{ color: colors.muted }}>Category: {assignment.item_category ?? "Uncategorized"}</Text>
                  <Text style={{ color: colors.muted }}>Room: {assignment.item_room ?? "Not assigned"}</Text>
                  <Text style={{ color: colors.muted }}>Checked out: {new Date(assignment.checked_out_at).toLocaleString()}</Text>
                  <PrimaryButton disabled={saving} label={saving ? "Working..." : "Check In"} onPress={() => void handleCheckIn(assignment.id)} />
                </View>
              ))
            )}
          </Card>

          <Card>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>Checked In</Text>
            <Text style={{ color: colors.muted }}>
              Check-in closes the assignment and puts the inventory item back into available status.
            </Text>
            {completedAssignments.length === 0 ? (
              <Text style={{ color: colors.muted }}>No completed check-ins yet.</Text>
            ) : (
              completedAssignments.map((assignment) => (
                <View key={assignment.id} style={{ gap: 4 }}>
                  <Text style={{ color: colors.text, fontWeight: "700" }}>
                    {assignment.item_name} ({assignment.item_code})
                  </Text>
                  <Text style={{ color: colors.muted }}>
                    Checked in: {assignment.checked_in_at ? new Date(assignment.checked_in_at).toLocaleString() : "Unknown"}
                  </Text>
                </View>
              ))
            )}
          </Card>
          <Modal animationType="slide" transparent visible={isEditingPackRequest} onRequestClose={resetPackRequestForm}>
            <View
              style={{
                flex: 1,
                backgroundColor: "rgba(18, 18, 18, 0.68)",
                justifyContent: "center",
                padding: 20,
              }}
            >
              <View
                style={{
                  maxHeight: "88%",
                  borderRadius: 24,
                  backgroundColor: colors.panel,
                  padding: 18,
                  gap: 14,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <Text style={{ color: colors.text, fontSize: 18, fontWeight: "800" }}>Edit Pack Request</Text>
                <Text style={{ color: colors.muted }}>
                  Update this request here, then save or cancel. Save stays disabled until something changes.
                </Text>
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
                  <Field label="Request" onChangeText={setRequestText} placeholder="4 blue pillows, 1 ladder, dining table art..." value={requestText} />
                  <View style={{ flexDirection: "row", gap: 12 }}>
                    <View style={{ flex: 1 }}>
                      <Field label="Quantity" keyboardType="numeric" onChangeText={setRequestQuantity} value={requestQuantity} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field label="Room" onChangeText={setRequestRoom} value={requestRoom} />
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", gap: 12 }}>
                    <View style={{ flex: 1 }}>
                      <Field label="Category" onChangeText={setRequestCategory} value={requestCategory} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field label="Color" onChangeText={setRequestColor} value={requestColor} />
                    </View>
                  </View>
                  <Field label="Notes" multiline onChangeText={setRequestNotes} placeholder="Optional styling notes, alternates, or client preferences." value={requestNotes} />
                  <SecondaryButton label={requestOptional ? "Optional item selected" : "Mark as Optional"} onPress={() => setRequestOptional((current) => !current)} />
                  <Field label="Link exact inventory item" onChangeText={setRequestSearch} placeholder="Search by item code, name, category, color..." value={requestSearch} />
                  {!requestSearch.trim() ? (
                    <Text style={{ color: colors.muted }}>Start typing to search the full inventory by name, item code, category, room, or color.</Text>
                  ) : (
                    <Card>
                      <Text style={{ color: colors.text, fontSize: 15, fontWeight: "700" }}>
                        {filteredPackCandidates.length} matching items
                      </Text>
                      <Text style={{ color: colors.muted }}>
                        {filteredPackCandidates.length > visiblePackCandidates.length
                          ? `Showing the first ${visiblePackCandidates.length}. Refine the search to narrow it down.`
                          : "Showing all current matches."}
                      </Text>
                    </Card>
                  )}
                  <View style={{ gap: 10 }}>
                    {visiblePackCandidates.map((item) => (
                      <Card key={item.id}>
                        <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
                          {item.thumbnail_url ? (
                            <Pressable onPress={() => handleOpenPreview(item.thumbnail_url, `${item.name} (${item.item_code})`)}>
                              <CachedImage
                                alt=""
                                cachePolicy="memory-disk"
                                contentFit="cover"
                                source={{ uri: item.thumbnail_url }}
                                style={{ width: 72, height: 72, borderRadius: 12, backgroundColor: colors.panelAlt }}
                              />
                            </Pressable>
                          ) : null}
                          <View style={{ flex: 1, gap: 4 }}>
                            <Text style={{ color: colors.text, fontSize: 15, fontWeight: "700" }}>{item.name}</Text>
                            <Text style={{ color: colors.muted }}>{item.item_code}</Text>
                            <Text style={{ color: colors.muted }}>
                              {item.category ?? "No category"} • {item.color ?? "No color"} • {item.current_location_name ?? "No location"}
                            </Text>
                            {item.thumbnail_url ? <Text style={{ color: colors.muted }}>Tap image to preview.</Text> : null}
                          </View>
                        </View>
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                          <SecondaryButton
                            label={selectedPackItemId === item.id ? "Selected" : "Select Item"}
                            onPress={() => setSelectedPackItemId((current) => (current === item.id ? null : item.id))}
                          />
                          <SecondaryButton label="Open Item" onPress={() => openInventoryItem(item.id)} />
                          {item.thumbnail_url ? (
                            <SecondaryButton label="Preview" onPress={() => handleOpenPreview(item.thumbnail_url, `${item.name} (${item.item_code})`)} />
                          ) : null}
                        </View>
                      </Card>
                    ))}
                  </View>
                </ScrollView>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <SecondaryButton disabled={saving} label="Cancel" onPress={resetPackRequestForm} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <PrimaryButton
                      disabled={saving || !packRequestDirty}
                      label={saving ? "Working..." : "Save Changes"}
                      onPress={() => void handleCreateOrUpdatePackRequest()}
                    />
                  </View>
                </View>
              </View>
            </View>
          </Modal>
          <Modal animationType="slide" transparent visible={showAddPickList} onRequestClose={() => setShowAddPickList(false)}>
            <View
              style={{
                flex: 1,
                backgroundColor: "rgba(18, 18, 18, 0.68)",
                justifyContent: "center",
                padding: 20,
              }}
            >
              <View
                style={{
                  maxHeight: "88%",
                  borderRadius: 24,
                  backgroundColor: colors.panel,
                  padding: 18,
                  gap: 14,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <Text style={{ color: colors.text, fontSize: 18, fontWeight: "800" }}>Quick Select Inventory</Text>
                <Text style={{ color: colors.muted }}>
                  Use search, availability, and location filters here without stretching the project page. This modal scrolls independently.
                </Text>
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
                  <InventoryThumbnailPicker
                    items={filteredPickCandidates}
                    search={pickSearch}
                    onSearchChange={setPickSearch}
                    selectedItemIds={selectedPickItemIds}
                    onToggleItem={(itemId) =>
                      setSelectedPickItemIds((current) => (current.includes(itemId) ? current.filter((value) => value !== itemId) : [...current, itemId]))
                    }
                    availabilityFilter={pickAvailabilityFilter}
                    onAvailabilityFilterChange={setPickAvailabilityFilter}
                    locationFilter={pickLocationFilter}
                    onLocationFilterChange={setPickLocationFilter}
                    locationOptions={quickSelectLocationOptions}
                    onOpenItem={(itemId) => openInventoryItem(itemId)}
                    onPreviewItem={(item) => handleOpenPreview(item.thumbnail_url, `${item.name} (${item.item_code})`)}
                  />
                </ScrollView>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <SecondaryButton disabled={saving} label="Close" onPress={() => setShowAddPickList(false)} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <PrimaryButton
                      disabled={saving}
                      label={saving ? "Working..." : `Keep ${selectedPickItemIds.length} Selected`}
                      onPress={() => setShowAddPickList(false)}
                    />
                  </View>
                </View>
              </View>
            </View>
          </Modal>
          <Modal animationType="fade" transparent visible={Boolean(previewImageUrl)} onRequestClose={handleClosePreview}>
            <View
              style={{
                flex: 1,
                backgroundColor: "rgba(0,0,0,0.92)",
                padding: 20,
                paddingTop: 56,
                gap: 16,
              }}
            >
              <View style={{ paddingHorizontal: 6, gap: 8 }}>
                <SecondaryButton label="Close Viewer" onPress={handleClosePreview} />
                {previewTitle ? <Text style={{ color: "#f8f5ef", fontSize: 14, fontWeight: "700", textAlign: "center" }}>{previewTitle}</Text> : null}
                <Text style={{ color: "#d8d2c7", fontSize: 13, textAlign: "center" }}>
                  Use the zoom buttons for closer inspection. On iPhone you can also pinch.
                </Text>
                <View style={{ flexDirection: "row", justifyContent: "center", flexWrap: "wrap", gap: 8 }}>
                  <SecondaryButton label="Zoom Out" onPress={() => setPreviewZoom((current) => Math.max(1, Number((current - 0.5).toFixed(2))))} />
                  <SecondaryButton label="Reset" onPress={() => setPreviewZoom(1)} />
                  <SecondaryButton label="Zoom In" onPress={() => setPreviewZoom((current) => Math.min(4, Number((current + 0.5).toFixed(2))))} />
                </View>
              </View>
              {previewImageUrl ? (
                <ScrollView
                  bouncesZoom
                  centerContent
                  contentContainerStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center" }}
                  maximumZoomScale={4}
                  minimumZoomScale={1}
                  showsHorizontalScrollIndicator={false}
                  showsVerticalScrollIndicator={false}
                  style={{ width: "100%", height: "72%" }}
                >
                  <CachedImage
                    alt=""
                    cachePolicy="memory-disk"
                    contentFit="contain"
                    key={`${previewImageUrl}-${previewZoom}`}
                    source={{ uri: previewImageUrl }}
                    style={{ width: previewImageWidth, height: previewImageHeight }}
                  />
                </ScrollView>
              ) : null}
            </View>
          </Modal>
        </>
      ) : null}
    </AppScreen>
  );
}
