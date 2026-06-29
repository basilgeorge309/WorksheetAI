import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

type HandwritingStyle = 'neat' | 'average' | 'messy';

const STYLE_OPTIONS: { key: HandwritingStyle; label: string }[] = [
  { key: 'neat', label: 'Neat' },
  { key: 'average', label: 'Average' },
  { key: 'messy', label: 'Messy' },
];

export default function HomeScreen() {
  const [selectedStyle, setSelectedStyle] = useState<HandwritingStyle>('average');
  // No file picking wired up this session — kept null so "Fill it in" stays disabled.
  const [pickedFileName] = useState<string | null>(null);

  const canFill = pickedFileName !== null;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}>
      <Text style={styles.appName}>WorksheetAI</Text>
      <Text style={styles.tagline}>
        Upload a worksheet and let AI fill in the answers.
      </Text>

      <Pressable style={styles.uploadButton}>
        <Ionicons name="cloud-upload-outline" size={24} color="#ffffff" />
        <Text style={styles.uploadButtonText}>Upload Worksheet (PDF)</Text>
      </Pressable>

      <Text style={styles.usageText}>3 free worksheets remaining this month</Text>

      <Text style={styles.sectionLabel}>Handwriting style</Text>
      <View style={styles.chipRow}>
        {STYLE_OPTIONS.map((option) => {
          const isSelected = option.key === selectedStyle;
          return (
            <Pressable
              key={option.key}
              onPress={() => setSelectedStyle(option.key)}
              style={[styles.chip, isSelected && styles.chipSelected]}>
              <Text
                style={[
                  styles.chipText,
                  isSelected && styles.chipTextSelected,
                ]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        disabled={!canFill}
        style={[styles.fillButton, !canFill && styles.fillButtonDisabled]}>
        <Text
          style={[
            styles.fillButtonText,
            !canFill && styles.fillButtonTextDisabled,
          ]}>
          Fill it in →
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F8F9FB',
  },
  content: {
    padding: 24,
    paddingTop: 32,
  },
  appName: {
    fontSize: 32,
    fontWeight: '800',
    color: '#111827',
  },
  tagline: {
    marginTop: 6,
    fontSize: 15,
    color: '#6B7280',
  },
  uploadButton: {
    marginTop: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#4F46E5',
    paddingVertical: 18,
    borderRadius: 14,
  },
  uploadButtonText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
  usageText: {
    marginTop: 12,
    textAlign: 'center',
    fontSize: 14,
    color: '#6B7280',
  },
  sectionLabel: {
    marginTop: 32,
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: '#9CA3AF',
  },
  chipRow: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 10,
  },
  chip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#ffffff',
  },
  chipSelected: {
    borderColor: '#4F46E5',
    backgroundColor: '#EEF2FF',
  },
  chipText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#374151',
  },
  chipTextSelected: {
    color: '#4F46E5',
  },
  fillButton: {
    marginTop: 36,
    alignItems: 'center',
    paddingVertical: 18,
    borderRadius: 14,
    backgroundColor: '#111827',
  },
  fillButtonDisabled: {
    backgroundColor: '#E5E7EB',
  },
  fillButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#ffffff',
  },
  fillButtonTextDisabled: {
    color: '#9CA3AF',
  },
});
