import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { getInventoryCategoryFamily, getInventoryCategoryGroups, inventoryCategoryFamilies, type InventoryCategoryFamily } from "../lib/inventory-taxonomy";
import { colors } from "../lib/theme";

function Chip({
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

export function CategoryPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const currentFamily = getInventoryCategoryFamily(value);
  const [browserFamily, setBrowserFamily] = useState<InventoryCategoryFamily | null>(null);

  const activeFamily = browserFamily ?? currentFamily;
  const groups = getInventoryCategoryGroups(activeFamily);

  return (
    <View style={{ gap: 10 }}>
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: "700" }}>Category Family</Text>
        <Text style={{ color: colors.muted, lineHeight: 20 }}>Tap a family, then a subcategory to fill the category field with a canonical label.</Text>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {inventoryCategoryFamilies.map((family) => (
          <Chip
            active={activeFamily === family}
            key={family}
            label={family}
            onPress={() => setBrowserFamily((current) => (current === family ? null : family))}
          />
        ))}
      </View>
      {groups.map((group) => (
        <View key={`${activeFamily ?? "none"}-${group.label}`} style={{ gap: 8 }}>
          <Text style={{ color: colors.text, fontSize: 13, fontWeight: "700" }}>{group.label}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {group.options.map((option) => (
              <Chip active={value.trim() === option.value} key={option.value} label={option.label} onPress={() => onChange(option.value)} />
            ))}
          </View>
        </View>
      ))}
      {!!value.trim() ? (
        <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 18 }}>Current category: {value.trim()}</Text>
      ) : (
        <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 18 }}>You can still type a custom category if the taxonomy does not fit.</Text>
      )}
    </View>
  );
}
