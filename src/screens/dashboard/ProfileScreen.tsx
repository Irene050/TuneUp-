import AppHeader from '@/components/appheader';
import { useAuth } from '@/hooks/useAuth';
import { useProgress } from '@/hooks/useProgress';
import {
  changeCurrentPassword,
  deleteCurrentAccount,
  logoutUser,
  updateCurrentUserProfile,
} from '@/services/firebase/authService';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { COLORS } from '@/constants/appConstants';

function ModalHeader({
  title,
  onBack,
}: {
  title: string;
  onBack: () => void;
}) {
  return (
    <View style={styles.modalHeader}>
      <Pressable
        style={styles.backButton}
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel={`Back from ${title}`}
        hitSlop={8}
      >
        <Ionicons name="arrow-back" size={22} color={COLORS.brown} />
      </Pressable>

      <Text style={styles.modalTitle}>{title}</Text>
    </View>
  );
}

export default function ProfileScreen() {
  const { userName, userPhotoURL } = useAuth();

  const {
    summaries: progressSummaries,
    loading: progressLoading,
  } = useProgress();

  const displayName = userName.trim() || 'Singer';

  const [editVisible, setEditVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [deleteConfirmVisible, setDeleteConfirmVisible] =
    useState(false);

  const [nameDraft, setNameDraft] = useState(displayName);
  const [profileName, setProfileName] = useState(displayName);
  const [photoDraft, setPhotoDraft] = useState<string | null>(
    userPhotoURL,
  );

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const avatarInitial = (profileName.trim() || 'Singer')
    .charAt(0)
    .toUpperCase();

  const draftInitial = (nameDraft.trim() || 'Singer')
    .charAt(0)
    .toUpperCase();

  const tierRank = {
    beginner: 0,
    intermediate: 1,
    advanced: 2,
  } as const;

  const overallTier = progressSummaries.reduce(
    (highestTier, summary) =>
      tierRank[summary.currentTier] > tierRank[highestTier]
        ? summary.currentTier
        : highestTier,
    'beginner' as keyof typeof tierRank,
  );

  const formattedTier =
    overallTier.charAt(0).toUpperCase() + overallTier.slice(1);

  useEffect(() => {
    setNameDraft(displayName);
    setProfileName(displayName);
    setPhotoDraft(userPhotoURL);
  }, [displayName, userPhotoURL]);

  const pickPhoto = async () => {
    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        setError('Photo library permission is required.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled) {
        setPhotoDraft(result.assets[0].uri);
        setError(null);
      }
    } catch (photoError) {
      console.error('Photo picker error:', photoError);
      setError('Unable to select a profile photo.');
    }
  };

  const saveProfile = async () => {
    if (!nameDraft.trim()) {
      setError('Please enter your name.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await updateCurrentUserProfile(nameDraft.trim(), photoDraft);
      setProfileName(nameDraft.trim());
      setEditVisible(false);
    } catch (saveError: any) {
      setError(
        saveError?.message ?? 'Unable to update your profile.',
      );
    } finally {
      setSaving(false);
    }
  };

  const updatePassword = async () => {
    if (!currentPassword.trim() || !newPassword) {
      setError('Please enter your current and new passwords.');
      return;
    }

    if (newPassword.length < 6) {
      setError('Your new password must be at least 6 characters.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await changeCurrentPassword(currentPassword, newPassword);

      setCurrentPassword('');
      setNewPassword('');
      setSettingsVisible(false);

      Alert.alert(
        'Password updated',
        'Your password has been changed.',
      );
    } catch (passwordError: any) {
      setError(
        passwordError?.message ?? 'Unable to change your password.',
      );
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteAccount = () => {
    setError(null);
    setDeletePassword('');
    setDeleteConfirmVisible(true);
  };

  const deleteAccount = async () => {
    if (!deletePassword.trim()) {
      setError('Please enter your password to delete your account.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await deleteCurrentAccount(deletePassword);

      setDeleteConfirmVisible(false);
      setSettingsVisible(false);
      setCurrentPassword('');
      setNewPassword('');
      setDeletePassword('');

      router.replace({
        pathname: '/[auth]',
        params: { auth: 'login' },
      });
    } catch (deleteError: any) {
      console.error('Delete account error:', deleteError);

      setError(
        deleteError?.message ?? 'Unable to delete your account.',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logoutUser();

      router.replace({
        pathname: '/[auth]',
        params: { auth: 'login' },
      });
    } catch (logoutError) {
      console.error('Logout error:', logoutError);

      Alert.alert(
        'Logout failed',
        'Unable to log out. Please try again.',
      );
    }
  };

  const openEditProfile = () => {
    setError(null);
    setNameDraft(profileName);
    setPhotoDraft(userPhotoURL);
    setEditVisible(true);
  };

  const closeEditProfile = () => {
    setError(null);
    setEditVisible(false);
  };

  const closeSettings = () => {
    setError(null);
    setSettingsVisible(false);
    setCurrentPassword('');
    setNewPassword('');
  };

  return (
    <View style={styles.screen}>
      <AppHeader />

      <View style={styles.content}>
        <View style={styles.profileSection}>
          {userPhotoURL ? (
            <Image
              source={{ uri: userPhotoURL }}
              style={styles.avatar}
            />
          ) : (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{avatarInitial}</Text>
            </View>
          )}

          <Text style={styles.name}>{profileName}</Text>

          <Text style={styles.tier}>
            {progressLoading
              ? 'Loading tier...'
              : `${formattedTier} tier`}
          </Text>

          <Pressable
            style={styles.editButton}
            onPress={openEditProfile}
          >
            <Text style={styles.editText}>Edit Profile</Text>
          </Pressable>
        </View>

        <View style={styles.optionsContainer}>
          <Pressable
            style={styles.optionCard}
            onPress={() => {
              setError(null);
              setSettingsVisible(true);
            }}
          >
            <View style={styles.optionIcon}>
              <Ionicons
                name="settings"
                size={28}
                color={COLORS.gray}
              />
            </View>

            <Text style={styles.optionText}>Account Settings</Text>

            <Ionicons
              name="chevron-forward"
              size={22}
              color={COLORS.gray}
            />
          </Pressable>

          <Pressable
            style={styles.optionCard}
            onPress={() =>
              router.push({
                pathname: '/dashboard',
                params: { tab: 'progress' },
              })
            }
          >
            <View style={styles.progressIcon}>
              <Ionicons
                name="bar-chart"
                size={28}
                color={COLORS.guideGreen}
              />
            </View>

            <Text style={styles.optionText}>View Progress</Text>

            <Ionicons
              name="chevron-forward"
              size={22}
              color={COLORS.gray}
            />
          </Pressable>
        </View>

        <Pressable
          style={styles.logoutButton}
          onPress={handleLogout}
        >
          <Text style={styles.logoutText}>Log out</Text>
        </Pressable>
      </View>

      <Modal
        visible={editVisible}
        transparent
        animationType="slide"
        onRequestClose={closeEditProfile}
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalCard}>
            <ModalHeader
              title="Edit Profile"
              onBack={closeEditProfile}
            />

            <Pressable
              style={styles.photoPicker}
              onPress={pickPhoto}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="Change profile photo"
            >
              {photoDraft ? (
                <Image
                  source={{ uri: photoDraft }}
                  style={styles.changePhotoAvatar}
                />
              ) : (
                <View style={styles.changePhotoAvatar}>
                  <Text style={styles.changePhotoAvatarText}>
                    {draftInitial}
                  </Text>
                </View>
              )}

              <Text style={styles.photoPickerText}>
                Change photo
              </Text>
            </Pressable>

            <TextInput
              style={styles.input}
              value={nameDraft}
              onChangeText={setNameDraft}
              placeholder="Your name"
              placeholderTextColor={COLORS.gray}
              autoCapitalize="words"
              editable={!saving}
            />

            {error && (
              <Text style={styles.errorText}>{error}</Text>
            )}

            <View style={styles.modalActions}>
              <Pressable
                style={styles.cancelButton}
                onPress={closeEditProfile}
                disabled={saving}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>

              <Pressable
                style={styles.saveProfileButton}
                onPress={saveProfile}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color={COLORS.white} />
                ) : (
                  <Text style={styles.saveProfileButtonText}>
                    Save
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={settingsVisible}
        transparent
        animationType="slide"
        onRequestClose={closeSettings}
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalCard}>
            <ModalHeader
              title="Account Settings"
              onBack={closeSettings}
            />

            <Text style={styles.fieldLabel}>Change password</Text>

            <TextInput
              style={styles.input}
              value={currentPassword}
              onChangeText={setCurrentPassword}
              placeholder="Current password"
              placeholderTextColor={COLORS.gray}
              secureTextEntry
              autoCapitalize="none"
              editable={!saving}
            />

            <TextInput
              style={styles.input}
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="New password"
              placeholderTextColor={COLORS.gray}
              secureTextEntry
              autoCapitalize="none"
              editable={!saving}
            />

            {error && (
              <Text style={styles.errorText}>{error}</Text>
            )}

            <Pressable
              style={styles.primaryModalButton}
              onPress={updatePassword}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <Text style={styles.primaryModalText}>
                  Update password
                </Text>
              )}
            </Pressable>

            <Pressable
              style={styles.deleteButton}
              onPress={confirmDeleteAccount}
              disabled={saving}
            >
              <Text style={styles.deleteButtonText}>
                Delete account
              </Text>
            </Pressable>

            <Pressable
              style={styles.closeButton}
              onPress={closeSettings}
              disabled={saving}
            >
              <Text style={styles.cancelButtonText}>Close</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={deleteConfirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!saving) {
            setDeleteConfirmVisible(false);
            setDeletePassword('');
            setError(null);
          }
        }}
      >
        <View style={styles.deleteBackdrop}>
          <View style={styles.deleteConfirmCard}>
            <View style={styles.deleteIconCircle}>
              <Ionicons
                name="warning-outline"
                size={30}
                color={COLORS.error}
              />
            </View>

            <Text style={styles.deleteConfirmTitle}>
              Delete account?
            </Text>

            <Text style={styles.deleteConfirmMessage}>
              This will permanently delete your account and progress.
              This action cannot be undone.
            </Text>

            <TextInput
              style={styles.deleteInput}
              value={deletePassword}
              onChangeText={(value) => {
                setDeletePassword(value);
                setError(null);
              }}
              placeholder="Enter your current password"
              placeholderTextColor={COLORS.gray}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              editable={!saving}
            />

            {error && (
              <Text style={styles.errorText}>{error}</Text>
            )}

            <View style={styles.deleteConfirmActions}>
              <Pressable
                style={styles.deleteCancelButton}
                onPress={() => {
                  setDeleteConfirmVisible(false);
                  setDeletePassword('');
                  setError(null);
                }}
                disabled={saving}
              >
                <Text style={styles.deleteCancelText}>Cancel</Text>
              </Pressable>

              <Pressable
                style={styles.deleteConfirmButton}
                onPress={deleteAccount}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color={COLORS.white} />
                ) : (
                  <Text style={styles.deleteConfirmButtonText}>
                    Delete
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 70,
    paddingBottom: 120,
  },
  profileSection: {
    alignItems: 'center',
    marginBottom: 36,
  },
  avatar: {
    width: 94,
    height: 94,
    borderRadius: 47,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  avatarText: {
    fontFamily: 'FredokaBold',
    fontSize: 36,
    color: COLORS.brown,
  },
  name: {
    fontFamily: 'FredokaBold',
    fontSize: 21,
    color: COLORS.brown,
    marginBottom: 8,
  },
  tier: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: COLORS.muted,
    marginBottom: 8,
  },
  editButton: {
    minWidth: 84,
    height: 22,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  editText: {
    fontFamily: 'FredokaBold',
    fontSize: 8,
    color: COLORS.brown,
  },
  optionsContainer: {
    width: '100%',
    gap: 18,
  },
  optionCard: {
    width: '100%',
    height: 75,
    marginBottom: -6,
    backgroundColor: COLORS.lightGray,
    borderRadius: 17,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: COLORS.gray,
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: {
      width: 0,
      height: 3,
    },
    elevation: 3,
  },
  optionIcon: {
    width: 38,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 20,
  },
  progressIcon: {
    width: 38,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 20,
  },
  optionText: {
    flex: 1,
    fontFamily: 'FredokaBold',
    fontSize: 19,
    color: COLORS.brown,
  },
  logoutButton: {
    width: 107,
    height: 38,
    borderRadius: 20,
    backgroundColor: COLORS.error,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 70,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  logoutText: {
    fontFamily: 'FredokaBold',
    fontSize: 14,
    color: COLORS.white,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: COLORS.gray,
  },
  modalCard: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 34,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.lightGray,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  modalTitle: {
    flex: 1,
    fontFamily: 'FredokaBold',
    fontSize: 22,
    color: COLORS.brown,
  },
  photoPicker: {
    alignItems: 'center',
    marginBottom: 16,
  },
  changePhotoAvatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 7,
  },
  changePhotoAvatarText: {
    fontFamily: 'FredokaBold',
    fontSize: 28,
    color: COLORS.brown,
  },
  photoPickerText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
    color: COLORS.brown,
  },
  fieldLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 13,
    color: COLORS.brown,
    marginBottom: 8,
  },
  input: {
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    color: COLORS.brown,
    marginBottom: 8,
    backgroundColor: COLORS.white,
  },
  deleteInput: {
    height: 46,
    width: 300,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    color: COLORS.brown,
    marginBottom: 20,
    backgroundColor: COLORS.white,
  },
  errorText: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: COLORS.error,
    marginBottom: 10,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
  },
  cancelButton: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.lightGray,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 14,
    color: COLORS.brown,
  },
  saveProfileButton: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.brown,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveProfileButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 14,
    color: COLORS.white,
  },
  primaryModalButton: {
    minHeight: 46,
    borderRadius: 23,
    backgroundColor: COLORS.brown,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  primaryModalText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 14,
    color: COLORS.white,
    textAlign: 'center',
  },
  closeButton: {
    minHeight: 46,
    borderRadius: 23,
    backgroundColor: COLORS.lightGray,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteButton: {
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  deleteButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 14,
    color: COLORS.error,
  },
  deleteBackdrop: {
    flex: 1,
    backgroundColor: COLORS.gray,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  deleteConfirmCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: COLORS.white,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  deleteIconCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  deleteConfirmTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 22,
    color: COLORS.brown,
    textAlign: 'center',
    marginBottom: 10,
  },
  deleteConfirmMessage: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    color: COLORS.muted,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 24,
  },
  deleteConfirmActions: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  deleteCancelButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 23,
    backgroundColor: COLORS.lightGray,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteCancelText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 14,
    color: COLORS.brown,
  },
  deleteConfirmButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 23,
    backgroundColor: COLORS.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteConfirmButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 14,
    color: COLORS.white,
  },
});