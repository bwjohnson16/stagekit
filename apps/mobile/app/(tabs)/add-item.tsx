import { useEffect, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";

import * as ImagePicker from "expo-image-picker";

import { CategoryPicker } from "../../src/components/category-picker";
import { AppScreen, Card, Field, Hero, Message, PrimaryButton, SecondaryButton } from "../../src/components/ui";
import { listJobs, type Job } from "../../src/lib/jobs";
import { createInventoryItemWithPhotos } from "../../src/lib/inventory";
import { colors } from "../../src/lib/theme";

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

export default function AddItemTab() {
  const [rapidMode, setRapidMode] = useState(true);
  const [reuseCategory, setReuseCategory] = useState(true);
  const [reuseColor, setReuseColor] = useState(true);
  const [reuseDimensions, setReuseDimensions] = useState(false);
  const [reuseTags, setReuseTags] = useState(true);
  const [autoOpenCamera, setAutoOpenCamera] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [color, setColor] = useState("");
  const [dimensions, setDimensions] = useState("");
  const [room, setRoom] = useState("");
  const [batchName, setBatchName] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [notes, setNotes] = useState("");
  const [markedForDisposal, setMarkedForDisposal] = useState(false);
  const [estimatedListPrice, setEstimatedListPrice] = useState("");
  const [cost, setCost] = useState("");
  const [replacementCost, setReplacementCost] = useState("");
  const [imageUris, setImageUris] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  useEffect(() => {
    listJobs().then(setJobs).catch(() => undefined);
  }, []);

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
      <Pressable
        onPress={onPress}
        style={{
          backgroundColor: active ? colors.accent : colors.panel,
          borderColor: active ? colors.accentDark : colors.border,
          borderRadius: 999,
          borderWidth: 1,
          paddingHorizontal: 12,
          paddingVertical: 8,
        }}
      >
        <Text style={{ color: active ? colors.accentText : colors.text, fontSize: 13, fontWeight: "700" }}>{label}</Text>
      </Pressable>
    );
  }

  function resetForNextItem() {
    setName("");
    setNotes("");
    setMarkedForDisposal(false);
    setEstimatedListPrice("");
    setCost("");
    setReplacementCost("");
    setImageUris([]);

    if (!reuseCategory) {
      setCategory("");
    }
    if (!reuseColor) {
      setColor("");
    }
    if (!reuseDimensions) {
      setDimensions("");
    }
    if (!reuseTags) {
      setTagsText("");
    }
  }

  async function handleTakePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setMessage("Camera permission is required to take a photo.");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      cameraType: ImagePicker.CameraType.back,
      mediaTypes: ["images"],
      quality: 0.75,
    });

    if (!result.canceled) {
      const nextUri = result.assets[0]?.uri;
      if (nextUri) {
        setImageUris((current) => [...current, nextUri]);
      }
      setMessage(null);
    }
  }

  async function handleChoosePhotos() {
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

    if (!result.canceled) {
      const nextUris = (result.assets ?? []).map((asset) => asset.uri).filter(Boolean);
      if (nextUris.length > 0) {
        setImageUris((current) => [...current, ...nextUris]);
      }
      setMessage(null);
    }
  }

  function handleRemovePhoto(index: number) {
    setImageUris((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  async function handleSave() {
    if (!name.trim()) {
      setMessage("Item name is required.");
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const estimatedListingPriceCents = parseCurrencyInputToCents(estimatedListPrice, "Estimated list price");
      const purchasePriceCents = parseCurrencyInputToCents(cost, "Cost");
      const replacementCostCents = parseCurrencyInputToCents(replacementCost, "Replacement cost");

      await createInventoryItemWithPhotos({
        name: name.trim(),
        category,
        color,
        dimensions,
        room,
        batchName,
        tags: tagsText
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        notes,
        markedForDisposal,
        estimatedListingPriceCents,
        purchasePriceCents,
        replacementCostCents,
        sourceJobId: selectedJobId,
        imageUris,
      });

      if (rapidMode) {
        resetForNextItem();
        setMessage("Item saved. Ready for the next one.");

        if (autoOpenCamera) {
          setTimeout(() => {
            void handleTakePhoto();
          }, 250);
        }
      } else {
        setName("");
        setCategory("");
        setColor("");
        setDimensions("");
        setRoom("");
        setBatchName("");
        setTagsText("");
        setNotes("");
        setMarkedForDisposal(false);
        setEstimatedListPrice("");
        setCost("");
        setReplacementCost("");
        setSelectedJobId(null);
        setImageUris([]);
        setMessage("Item saved.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save item.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppScreen>
      <Hero
        eyebrow="Add Item"
        title={rapidMode ? "Rapid intake for destaging." : "Capture it while it’s in front of you."}
        subtitle={
          rapidMode
            ? "Keep the same house, batch, and room locked in while you move through a house item by item."
            : "Take a photo, record the basics, and save directly into Supabase."
        }
      />
      <Card>
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>Rapid Intake Mode</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <ToggleChip active={rapidMode} label={rapidMode ? "Rapid on" : "Rapid off"} onPress={() => setRapidMode((current) => !current)} />
          <ToggleChip active={autoOpenCamera} label="Auto camera" onPress={() => setAutoOpenCamera((current) => !current)} />
        </View>
        {rapidMode ? (
          <>
            <Text style={{ color: colors.muted, lineHeight: 20 }}>
              Context fields stay in place after each save. Choose which item details should carry forward to the next intake.
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <ToggleChip active={reuseCategory} label="Keep category" onPress={() => setReuseCategory((current) => !current)} />
              <ToggleChip active={reuseColor} label="Keep color" onPress={() => setReuseColor((current) => !current)} />
              <ToggleChip active={reuseDimensions} label="Keep dimensions" onPress={() => setReuseDimensions((current) => !current)} />
              <ToggleChip active={reuseTags} label="Keep tags" onPress={() => setReuseTags((current) => !current)} />
            </View>
          </>
        ) : null}
      </Card>
      <Card>
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>Intake Context</Text>
        <Field label="Room" onChangeText={setRoom} placeholder="Living room" value={room} />
        <Field label="Batch" onChangeText={setBatchName} placeholder="Lake House destage - day 1" value={batchName} />
        <Field label="Tags" onChangeText={setTagsText} placeholder="blue, velvet, lamp" value={tagsText} />
        <Field label="Item Name" onChangeText={setName} placeholder="Cream sofa" value={name} />
        {jobs.length > 0 ? (
          <View style={{ gap: 8 }}>
            <Text style={{ color: colors.text, fontSize: 14, fontWeight: "700" }}>Assign to House / Project</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {jobs.map((job) => {
                const active = selectedJobId === job.id;
                return (
                  <ToggleChip
                    active={active}
                    key={job.id}
                    label={job.name}
                    onPress={() => setSelectedJobId((current) => (current === job.id ? null : job.id))}
                  />
                );
              })}
            </View>
          </View>
        ) : null}
      </Card>
      <Card>
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>Item Details</Text>
        <Field label="Category" onChangeText={setCategory} placeholder="Tables / Coffee" value={category} />
        <CategoryPicker onChange={setCategory} value={category} />
        <Field label="Color" onChangeText={setColor} placeholder="Ivory" value={color} />
        <Field label="Dimensions" onChangeText={setDimensions} placeholder="84 x 36 x 34" value={dimensions} />
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: "700" }}>Disposition</Text>
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
        <Field label="Notes" multiline onChangeText={setNotes} placeholder="Condition or styling notes" value={notes} />
        {imageUris.length > 0 ? (
          <View style={{ gap: 8 }}>
            <Text style={{ color: "#49564f" }}>{imageUris.length} photo{imageUris.length === 1 ? "" : "s"} ready to upload.</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {imageUris.map((uri, index) => (
                <View key={`${uri}-${index}`} style={{ gap: 6 }}>
                  {/* eslint-disable-next-line jsx-a11y/alt-text */}
                  <Image source={{ uri }} style={{ width: 96, height: 96, borderRadius: 12, backgroundColor: colors.panelAlt }} />
                  <SecondaryButton label="Remove" onPress={() => handleRemovePhoto(index)} />
                </View>
              ))}
            </View>
          </View>
        ) : null}
        {message ? <Message text={message} tone={message.startsWith("Item saved") ? "success" : "error"} /> : null}
        <SecondaryButton label={imageUris.length > 0 ? "Add Camera Photo" : "Take Photo"} onPress={() => void handleTakePhoto()} />
        <SecondaryButton label="Choose from Library" onPress={() => void handleChoosePhotos()} />
        {rapidMode ? <SecondaryButton label="Clear Current Item" onPress={resetForNextItem} /> : null}
        <PrimaryButton
          disabled={saving}
          label={saving ? "Saving..." : rapidMode ? "Save + Next Item" : "Save + Tag Item"}
          onPress={() => void handleSave()}
        />
      </Card>
    </AppScreen>
  );
}
