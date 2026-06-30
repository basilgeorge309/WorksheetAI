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
            placeholderTextColor="#6B6B6B"
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
              <ActivityIndicator color="#FFFFFF" />
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
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 32,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E5E5',
    marginBottom: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  body: {
    marginTop: 12,
    fontSize: 14,
    lineHeight: 20,
    color: '#6B6B6B',
  },
  input: {
    marginTop: 20,
    width: '100%',
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    paddingHorizontal: 16,
    fontSize: 16,
    color: '#1A1A1A',
    backgroundColor: '#FFFFFF',
  },
  errorText: {
    marginTop: 12,
    fontSize: 13,
    color: '#DC2626',
  },
  deleteButton: {
    marginTop: 16,
    width: '100%',
    height: 52,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DC2626',
  },
  deleteButtonDisabled: {
    backgroundColor: '#E5E5E5',
  },
  deleteLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  cancelButton: {
    marginTop: 12,
    alignItems: 'center',
    paddingVertical: 8,
  },
  cancelLabel: {
    fontSize: 15,
    color: '#6B6B6B',
  },
});
