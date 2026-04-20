import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Image, Modal, Pressable, ScrollView, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";

import { AppScreen, Card, Field, Hero, LoadingState, Message, PrimaryButton, SecondaryButton } from "../../src/components/ui";
import { listLocations, type Location } from "../../src/lib/locations";
import { assignItemToJob, createExactItemPackRequest, listJobs, type Job } from "../../src/lib/jobs";
import { addInventoryItemPhotos, deleteInventoryItem, deleteInventoryPhoto, getInventoryItemContext, setInventoryPhotoCover, updateInventoryItem, type InventoryPhoto } from "../../src/lib/inventory";
import { colors } from "../../src/lib/theme";

function formatCurrencyFromCents(cents: number | null | undefined) {
  if (cents == null) {
    return "";
  }

  return (cents / 100).toFixed(2);
}

function parseCurrencyInputToCents(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.replaceAll(",", "").replaceAll("$", "");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error(`${label} must be a valid dollar amount.`);
  }

  return Math.round(Number.parseFloat(normalized) * 100);
}

function ToggleChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <SecondaryButton label={active ? `${label} selected` : label} onPress={onPress} />
  );
}

export default function InventoryItemScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; returnPath?: string; returnLabel?: string }>();
  const itemId = params.id;
  const returnPath = typeof params.returnPath === "string" && params.returnPath.trim() ? params.returnPath : null;
  const returnLabel = typeof params.returnLabel === "string" && params.returnLabel.trim() ? params.returnLabel : "Back to Inventory";
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [itemStatus, setItemStatus] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [color, setColor] = useState("");
  const [dimensions, setDimensions] = useState("");
  const [room, setRoom] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [notes, setNotes] = useState("");
  const [markedForDisposal, setMarkedForDisposal] = useState(false);
  const [estimatedListPrice, setEstimatedListPrice] = useState("");
  const [cost, setCost] = useState("");
  const [replacementCost, setReplacementCost] = useState("");
  const [currentLocationId, setCurrentLocationId] = useState<string | null>(null);
  const [sourceJobId, setSourceJobId] = useState<string | null>(null);
  const [itemCode, setItemCode] = useState("");
  const [photos, setPhotos] = useState<InventoryPhoto[]>([]);
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [showPackProjects, setShowPackProjects] = useState(false);
  const [showAssignProjects, setShowAssignProjects] = useState(false);
  const [activeAssignmentJobName, setActiveAssignmentJobName] = useState<string | null>(null);
  const [packListJobNames, setPackListJobNames] = useState<string[]>([]);

  useEffect(() => {
    if (!itemId) {
      return;
    }

    Promise.all([getInventoryItemContext(itemId), listLocations(), listJobs()])
      .then(([context, nextLocations, nextJobs]) => {
        setItemStatus(context.item.status);
        setName(context.item.name);
        setCategory(context.item.category ?? "");
        setColor(context.item.color ?? "");
        setDimensions(context.item.dimensions ?? "");
        setRoom(context.item.room ?? "");
        setTagsText(context.item.tags.join(", "));
        setNotes(context.item.notes ?? "");
        setMarkedForDisposal(context.item.marked_for_disposal);
        setEstimatedListPrice(formatCurrencyFromCents(context.item.estimated_listing_price_cents));
        setCost(formatCurrencyFromCents(context.item.purchase_price_cents));
        setReplacementCost(formatCurrencyFromCents(context.item.replacement_cost_cents));
        setCurrentLocationId(context.item.current_location_id ?? null);
        setSourceJobId(context.item.source_job_id ?? null);
        setItemCode(context.item.item_code);
        setLocations(nextLocations);
        setJobs(nextJobs);
        setPhotos(context.photos);
        setActivePhotoIndex(0);
        setActiveAssignmentJobName(context.activeAssignment?.job_name ?? null);
        setPackListJobNames(context.packListJobNames);
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : "Failed to load item.");
      })
      .finally(() => setLoading(false));
  }, [itemId]);

  async function reloadItemContext() {
    if (!itemId) {
      return;
    }

    const [context, nextLocations, nextJobs] = await Promise.all([getInventoryItemContext(itemId), listLocations(), listJobs()]);
    setItemStatus(context.item.status);
    setName(context.item.name);
    setCategory(context.item.category ?? "");
    setColor(context.item.color ?? "");
    setDimensions(context.item.dimensions ?? "");
    setRoom(context.item.room ?? "");
    setTagsText(context.item.tags.join(", "));
    setNotes(context.item.notes ?? "");
    setMarkedForDisposal(context.item.marked_for_disposal);
    setEstimatedListPrice(formatCurrencyFromCents(context.item.estimated_listing_price_cents));
    setCost(formatCurrencyFromCents(context.item.purchase_price_cents));
    setReplacementCost(formatCurrencyFromCents(context.item.replacement_cost_cents));
    setCurrentLocationId(context.item.current_location_id ?? null);
    setSourceJobId(context.item.source_job_id ?? null);
    setItemCode(context.item.item_code);
    setLocations(nextLocations);
    setJobs(nextJobs);
    setPhotos(context.photos);
    setActivePhotoIndex((current) => Math.min(current, Math.max(context.photos.length - 1, 0)));
    setActiveAssignmentJobName(context.activeAssignment?.job_name ?? null);
    setPackListJobNames(context.packListJobNames);
  }

  const selectedLocationName = useMemo(
    () => locations.find((location) => location.id === currentLocationId)?.name ?? "Not assigned",
    [locations, currentLocationId],
  );
  const selectedJobName = useMemo(() => jobs.find((job) => job.id === sourceJobId)?.name ?? "Not assigned", [jobs, sourceJobId]);
  const isAlreadyOnPackList = packListJobNames.length > 0;

  function handleBackPress() {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    if (returnPath) {
      router.replace(returnPath as Href);
      return;
    }

    router.replace("/inventory");
  }

  async function handleSave() {
    if (!itemId || !name.trim()) {
      setMessage("Item name is required.");
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const estimatedListingPriceCents = parseCurrencyInputToCents(estimatedListPrice, "Estimated list price");
      const purchasePriceCents = parseCurrencyInputToCents(cost, "Cost");
      const replacementCostCents = parseCurrencyInputToCents(replacementCost, "Replacement cost");

      await updateInventoryItem(itemId, {
        name: name.trim(),
        category: category.trim() || null,
        color: color.trim() || null,
        dimensions: dimensions.trim() || null,
        room: room.trim() || null,
        notes: notes.trim() || null,
        marked_for_disposal: markedForDisposal,
        estimated_listing_price_cents: estimatedListingPriceCents,
        purchase_price_cents: purchasePriceCents,
        replacement_cost_cents: replacementCostCents,
        tags: tagsText
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        current_location_id: currentLocationId,
        source_job_id: sourceJobId,
      });

      setMessage("Item updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to update item.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddToPackList(jobId: string) {
    if (!itemId) {
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      await createExactItemPackRequest({
        jobId,
        itemId,
        itemName: name,
        category: category || null,
        color: color || null,
        room: room || null,
      });
      setShowPackProjects(false);
      setMessage("Item added to the project pack list.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to add item to pack list.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAssignToProject(jobId: string) {
    if (!itemId) {
      return;
    }

    if (itemStatus !== "available") {
      setMessage(`Item is not available. Current status: ${itemStatus}.`);
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      await assignItemToJob(jobId, itemId);
      await reloadItemContext();
      setShowAssignProjects(false);
      setMessage("Item assigned.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to assign item.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddPhotos() {
    if (!itemId) {
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setMessage("Photo library permission is required to choose photos.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      mediaTypes: ["images"],
      quality: 0.75,
      selectionLimit: 10,
    });

    if (result.canceled) {
      return;
    }

    const imageUris = (result.assets ?? []).map((asset) => asset.uri).filter(Boolean);
    if (imageUris.length === 0) {
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      await addInventoryItemPhotos(itemId, imageUris);
      await reloadItemContext();
      setMessage(`Added ${imageUris.length} photo${imageUris.length === 1 ? "" : "s"}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to add photos.");
    } finally {
      setSaving(false);
    }
  }

  async function handleMakeCover(photoId: string) {
    if (!itemId) {
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      await setInventoryPhotoCover(itemId, photoId);
      await reloadItemContext();
      setActivePhotoIndex(0);
      setMessage("Cover photo updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to update cover photo.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePhoto(photoId: string) {
    if (!itemId) {
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      await deleteInventoryPhoto(itemId, photoId);
      await reloadItemContext();
      setMessage("Photo deleted.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to delete photo.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteItem() {
    if (!itemId) {
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      await deleteInventoryItem(itemId);
      router.replace("/inventory");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to delete item.");
      setSaving(false);
    }
  }

  return (
    <AppScreen>
      <Hero
        eyebrow="Inventory Item"
        title={name || "Item detail"}
        subtitle={`Code ${itemCode || "loading"} • Status: ${itemStatus || "loading"} • ${markedForDisposal ? "Dispose" : "Keep"} • Location: ${selectedLocationName} • House: ${selectedJobName}`}
      />
      <SecondaryButton label={returnLabel} onPress={handleBackPress} />
      {loading ? <LoadingState label="Loading item..." /> : null}
      {message ? <Message text={message} tone={message.startsWith("Failed") ? "error" : "success"} /> : null}
      {!loading ? (
        <>
          <Card>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>Photos</Text>
            {photos.length > 0 ? (
              <>
                <Pressable onPress={() => setViewerVisible(true)}>
                  <Image alt="" source={{ uri: photos[activePhotoIndex]?.url }} style={{ width: "100%", height: 280, borderRadius: 18, backgroundColor: colors.panelAlt }} />
                </Pressable>
                <Text style={{ color: colors.muted }}>Tap photo to enlarge.</Text>
                {photos.length > 1 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                    {photos.map((photo, index) => (
                      <View key={photo.id} style={{ gap: 6, width: 92 }}>
                        <Pressable onPress={() => setActivePhotoIndex(index)}>
                          <Image
                            alt=""
                            source={{ uri: photo.url }}
                            style={{
                              width: 84,
                              height: 84,
                              borderRadius: 12,
                              backgroundColor: colors.panelAlt,
                              borderWidth: activePhotoIndex === index ? 2 : 0,
                              borderColor: activePhotoIndex === index ? colors.accentDark : "transparent",
                            }}
                          />
                        </Pressable>
                        <SecondaryButton disabled={saving || index === 0} label={index === 0 ? "Cover" : "Make Cover"} onPress={() => void handleMakeCover(photo.id)} />
                        <SecondaryButton disabled={saving} label="Delete" onPress={() => void handleDeletePhoto(photo.id)} />
                      </View>
                    ))}
                  </ScrollView>
                ) : null}
                {photos.length === 1 ? (
                  <View style={{ gap: 8 }}>
                    <Text style={{ color: colors.muted }}>This photo is the cover image.</Text>
                    <SecondaryButton disabled={saving} label="Delete Photo" onPress={() => void handleDeletePhoto(photos[0].id)} />
                  </View>
                ) : null}
              </>
            ) : (
              <Text style={{ color: colors.muted }}>No photos attached yet.</Text>
            )}
            <SecondaryButton disabled={saving} label={saving ? "Working..." : "Add Photos"} onPress={() => void handleAddPhotos()} />
          </Card>
          <Card>
            <Field label="Item Name" onChangeText={setName} value={name} />
            <Field label="Category" onChangeText={setCategory} value={category} />
            <Field label="Color" onChangeText={setColor} value={color} />
            <Field label="Dimensions" onChangeText={setDimensions} value={dimensions} />
            <Field label="Room" onChangeText={setRoom} value={room} />
            <Field label="Tags" onChangeText={setTagsText} value={tagsText} />
            <Field label="Notes" multiline onChangeText={setNotes} value={notes} />
          </Card>
          <Card>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>Disposition and Pricing</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <ToggleChip active={!markedForDisposal} label="Keep" onPress={() => setMarkedForDisposal(false)} />
              <ToggleChip active={markedForDisposal} label="Dispose" onPress={() => setMarkedForDisposal(true)} />
            </View>
            <Field
              keyboardType="numeric"
              label="Estimated List Price (USD)"
              onChangeText={setEstimatedListPrice}
              placeholder="0.00"
              value={estimatedListPrice}
            />
            <Field keyboardType="numeric" label="Cost (USD)" onChangeText={setCost} placeholder="0.00" value={cost} />
            <Field
              keyboardType="numeric"
              label="Replacement Cost (USD)"
              onChangeText={setReplacementCost}
              placeholder="0.00"
              value={replacementCost}
            />
          </Card>
          <Card>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>Assign Item to Project</Text>
            <Text style={{ color: colors.muted }}>
              This checks the item out to a project. It will show under that project until someone checks it back in.
            </Text>
            {activeAssignmentJobName ? <Text style={{ color: colors.muted }}>Currently assigned to: {activeAssignmentJobName}</Text> : null}
            <SecondaryButton
              disabled={saving || itemStatus !== "available"}
              label={
                itemStatus === "available"
                  ? showAssignProjects
                    ? "Hide Projects"
                    : "Assign to Project"
                  : activeAssignmentJobName
                    ? `Assigned to ${activeAssignmentJobName}`
                    : `Unavailable (${itemStatus})`
              }
              onPress={() => setShowAssignProjects((current) => !current)}
            />
            {showAssignProjects && itemStatus === "available" ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {jobs.map((job) => (
                  <SecondaryButton
                    key={job.id}
                    disabled={saving}
                    label={saving ? "Assigning..." : job.name}
                    onPress={() => void handleAssignToProject(job.id)}
                  />
                ))}
              </View>
            ) : null}
          </Card>
          <Card>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>Add Exact Item to Pack List</Text>
            <Text style={{ color: colors.muted }}>
              This links the item to a project&apos;s pack list only. It does not check the item out or move it in warehouse tracking.
            </Text>
            {isAlreadyOnPackList ? <Text style={{ color: colors.muted }}>Already on pack list for: {packListJobNames.join(", ")}</Text> : null}
            <SecondaryButton
              disabled={saving}
              label={isAlreadyOnPackList ? (showPackProjects ? "Hide Projects" : "Add to Another Pack List") : showPackProjects ? "Hide Projects" : "Add to Pack List"}
              onPress={() => setShowPackProjects((current) => !current)}
            />
            {showPackProjects ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {jobs.map((job) => (
                  <SecondaryButton
                    key={job.id}
                    disabled={saving || packListJobNames.includes(job.name)}
                    label={saving ? "Adding..." : packListJobNames.includes(job.name) ? `${job.name} Added` : job.name}
                    onPress={() => void handleAddToPackList(job.id)}
                  />
                ))}
              </View>
            ) : null}
          </Card>
          <Card>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>Location Assignment</Text>
            <Text style={{ color: colors.muted }}>Current: {selectedLocationName}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {locations.map((location) => (
                <ToggleChip
                  active={currentLocationId === location.id}
                  key={location.id}
                  label={location.name}
                  onPress={() => setCurrentLocationId((current) => (current === location.id ? null : location.id))}
                />
              ))}
            </View>
          </Card>
          <Card>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>House Context</Text>
            <Text style={{ color: colors.muted }}>Imported from: {selectedJobName}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {jobs.map((job) => (
                <ToggleChip active={sourceJobId === job.id} key={job.id} label={job.name} onPress={() => setSourceJobId((current) => (current === job.id ? null : job.id))} />
              ))}
            </View>
            <Text style={{ color: colors.muted, lineHeight: 20 }}>
              Source house is only import context. Active project assignment and check-in are tracked separately on the project detail screen.
            </Text>
          </Card>
          <Card>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>Delete Item</Text>
            <Text style={{ color: colors.muted }}>
              This permanently removes the item, its photos, any active job assignment rows, and exact-item pack list links.
            </Text>
            <Pressable
              disabled={saving}
              onPress={() => void handleDeleteItem()}
              style={{
                alignItems: "center",
                backgroundColor: "#fff1f2",
                borderColor: "#fecdd3",
                borderRadius: 16,
                borderWidth: 1,
                paddingHorizontal: 16,
                paddingVertical: 14,
                opacity: saving ? 0.55 : 1,
              }}
            >
              <Text style={{ color: "#b42318", fontSize: 15, fontWeight: "700" }}>{saving ? "Working..." : "Delete Item"}</Text>
            </Pressable>
          </Card>
          <PrimaryButton disabled={saving} label={saving ? "Saving..." : "Save Item"} onPress={() => void handleSave()} />
          <Modal animationType="fade" transparent visible={viewerVisible} onRequestClose={() => setViewerVisible(false)}>
            <View
              style={{
                flex: 1,
                backgroundColor: "rgba(0,0,0,0.92)",
                padding: 20,
                paddingTop: 56,
                gap: 16,
              }}
            >
              <View style={{ paddingHorizontal: 6 }}>
                <SecondaryButton label="Close Viewer" onPress={() => setViewerVisible(false)} />
              </View>
              {photos[activePhotoIndex]?.url ? (
                <ScrollView
                  key={`viewer-${activePhotoIndex}`}
                  bouncesZoom
                  centerContent
                  contentContainerStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center" }}
                  maximumZoomScale={4}
                  minimumZoomScale={1}
                  showsHorizontalScrollIndicator={false}
                  showsVerticalScrollIndicator={false}
                  style={{ width: "100%", height: "72%" }}
                >
                  <Image
                    alt=""
                    source={{ uri: photos[activePhotoIndex].url }}
                    style={{ width: "100%", height: "100%", resizeMode: "contain" }}
                  />
                </ScrollView>
              ) : null}
              {photos.length > 1 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                  {photos.map((photo, index) => (
                    <Pressable key={`${photo.id}-viewer`} onPress={() => setActivePhotoIndex(index)}>
                      <Image
                        alt=""
                        source={{ uri: photo.url }}
                        style={{
                          width: 72,
                          height: 72,
                          borderRadius: 10,
                          backgroundColor: colors.panelAlt,
                          borderWidth: activePhotoIndex === index ? 2 : 0,
                          borderColor: activePhotoIndex === index ? colors.accent : "transparent",
                        }}
                      />
                    </Pressable>
                  ))}
                </ScrollView>
              ) : null}
            </View>
          </Modal>
        </>
      ) : null}
    </AppScreen>
  );
}
