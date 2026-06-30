import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { deleteAccount } from '../lib/auth';
import { colors, radius, border, shadow, type } from '../constants/theme';

type Props = {
  visible: boolean;
  onClose: () => void;
};

export default function DeleteAccountModal({ visible, onClose }: Props) {
  const router = useRouter();
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canDelete = confirmText === 'DELETE' && !deleting;

  const handleDelete = async () => {
    setError(null);
    setDeleting(true);
    const { success, error: deleteErr } = await deleteAccount();
    if (success) {
      setDeleting(false);
      setConfirmText('');
      router.replace('/onboarding');
      return;
    }
    setDeleting(false);
    setError(deleteErr ?? 'Failed to delete account');
  };

  const handleClose = () => {
    if (deleting) return;
    setConfirmText('');
    setError(null);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropFill} onPress={handleClose} />

        <View style={styles.sheet}>
          <View style={styles.handle} />

          <Text selectable={false} style={styles.title}>
            Delete your account?
          </Text>
          <Text selectable={false} style={styles.body}>
            This permanently deletes:{'\n'}
            - Your account and login{'\n'}
            - All worksheet history{'\n'}
            - Your subscription (cancel separately in the App Store){'\n\n'}
            This cannot be undone.
          </Text>

          <TextInput
            style={styles.input}
            placeholder="Type DELETE"
            placeholderTextColor={colors.graphite}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!deleting}
            value={confirmText}
            onChangeText={setConfirmText}
          />

          {error && (
            <Text selectable={false} style={styles.errorText}>
              {error}
            </Text>
          )}

          <Pressable
            accessibilityRole="button"
            disabled={!canDelete}
            onPress={handleDelete}
            style={[styles.deleteButton, !canDelete && styles.deleteButtonDisabled]}>
            {deleting ? (
              <ActivityIndicator color={colors.paper} />
            ) : (
              <Text selectable={false} style={styles.deleteLabel}>
                Delete my account
              </Text>
            )}
          </Pressable>

          <Pressable
            accessibilityRole="button"
            disabled={deleting}
            onPress={handleClose}
            style={styles.cancelButton}>
            <Text selectable={false} style={styles.cancelLabel}>
              Cancel
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  backdropFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 32,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.cardBorder,
    marginBottom: 20,
  },
  title: {
    ...type.titleSerif,
    color: colors.ink,
  },
  body: {
    ...type.small,
    marginTop: 12,
    lineHeight: 20,
    color: colors.graphite,
  },
  input: {
    ...border.hairline,
    ...type.body,
    marginTop: 20,
    width: '100%',
    height: 48,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    color: colors.ink,
    backgroundColor: colors.paper,
  },
  errorText: {
    ...type.small,
    marginTop: 12,
    color: colors.errorRed,
  },
  deleteButton: {
    ...shadow.button,
    marginTop: 16,
    width: '100%',
    height: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink,
  },
  deleteButtonDisabled: {
    backgroundColor: colors.mutedText,
    shadowOpacity: 0,
    elevation: 0,
  },
  deleteLabel: {
    ...type.buttonSerif,
    color: colors.paper,
  },
  cancelButton: {
    marginTop: 12,
    alignItems: 'center',
    paddingVertical: 8,
  },
  cancelLabel: {
    ...type.body,
    color: colors.graphite,
  },
});
