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
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Modal, Platform, Pressable, Text, TextInput, View } from 'react-native';

import { COLORS } from '@/constants/appConstants';
import { exerciseStyles } from '@/constants/exerciseStyles';
import type { Tier } from '@/constants/params';

function ModalHeader({
  title,
  onBack,
}: {
  title: string;
  onBack: () => void;
}) {
  return (
    <View style={exerciseStyles.modalHeader}>
      <Pressable
        style={exerciseStyles.backButton_Profile}
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel={`Back from ${title}`}
        hitSlop={8}
      >
        <Ionicons name="arrow-back" size={22} color={COLORS.brown} />
      </Pressable>

      <Text style={exerciseStyles.modalTitle_Profile}>{title}</Text>
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

  const TIER_RANK: Record<Tier, number> = {
      beginner: 0,
      intermediate: 1,
      advanced: 2,
   };

  const overallTier = progressSummaries.reduce<Tier>(
    (highestTier, summary) => {
      const currentTier: Tier = summary.currentTier;

      return TIER_RANK[currentTier] > TIER_RANK[highestTier]
        ? currentTier
        : highestTier;
    },
    'beginner',
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
    <View style={exerciseStyles.screen}>
      <AppHeader />

      <View style={exerciseStyles.content_Profile}>
        <View style={exerciseStyles.profileSection}>
          {userPhotoURL ? (
            <Image
              source={{ uri: userPhotoURL }}
              style={exerciseStyles.avatar_Profile}
            />
          ) : (
            <View style={exerciseStyles.avatar_Profile}>
              <Text style={exerciseStyles.noteValue}>{avatarInitial}</Text>
            </View>
          )}

          <Text style={exerciseStyles.name}>{profileName}</Text>

          <Text style={exerciseStyles.tier}>
            {progressLoading
              ? 'Loading tier...'
              : `${formattedTier} tier`}
          </Text>

          <Pressable
            style={exerciseStyles.editButton}
            onPress={openEditProfile}
          >
            <Text style={exerciseStyles.levelText}>Edit Profile</Text>
          </Pressable>
        </View>

        <View style={exerciseStyles.optionsContainer}>
          <Pressable
            style={exerciseStyles.optionCard}
            onPress={() => {
              setError(null);
              setSettingsVisible(true);
            }}
          >
            <View style={exerciseStyles.optionIcon}>
              <Ionicons
                name="settings"
                size={28}
                color={COLORS.gray}
              />
            </View>

            <Text style={exerciseStyles.optionText}>Account Settings</Text>

            <Ionicons
              name="chevron-forward"
              size={22}
              color={COLORS.gray}
            />
          </Pressable>

          <Pressable
            style={exerciseStyles.optionCard}
            onPress={() =>
              router.push({
                pathname: '/dashboard',
                params: { tab: 'progress' },
              })
            }
          >
            <View style={exerciseStyles.optionIcon}>
              <Ionicons
                name="bar-chart"
                size={28}
                color={COLORS.guideGreen}
              />
            </View>

            <Text style={exerciseStyles.optionText}>View Progress</Text>

            <Ionicons
              name="chevron-forward"
              size={22}
              color={COLORS.gray}
            />
          </Pressable>
        </View>

        <Pressable
          style={exerciseStyles.logoutButton}
          onPress={handleLogout}
        >
          <Text style={exerciseStyles.logoutText}>Log out</Text>
        </Pressable>
      </View>

      <Modal
        visible={editVisible}
        transparent
        animationType="slide"
        onRequestClose={closeEditProfile}
      >
        <KeyboardAvoidingView
          style={exerciseStyles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={exerciseStyles.modalCard_Profile}>
            <ModalHeader
              title="Edit Profile"
              onBack={closeEditProfile}
            />

            <Pressable
              style={exerciseStyles.photoPicker}
              onPress={pickPhoto}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="Change profile photo"
            >
              {photoDraft ? (
                <Image
                  source={{ uri: photoDraft }}
                  style={exerciseStyles.changePhotoAvatar}
                />
              ) : (
                <View style={exerciseStyles.changePhotoAvatar}>
                  <Text style={exerciseStyles.changePhotoAvatarText}>
                    {draftInitial}
                  </Text>
                </View>
              )}

              <Text style={exerciseStyles.progressTime}>
                Change photo
              </Text>
            </Pressable>

            <TextInput
              style={exerciseStyles.input_Profile}
              value={nameDraft}
              onChangeText={setNameDraft}
              placeholder="Your name"
              placeholderTextColor={COLORS.gray}
              autoCapitalize="words"
              editable={!saving}
            />

            {error && (
              <Text style={exerciseStyles.errorText_Profile}>{error}</Text>
            )}

            <View style={exerciseStyles.modalActions}>
              <Pressable
                style={exerciseStyles.cancelButton}
                onPress={closeEditProfile}
                disabled={saving}
              >
                <Text style={exerciseStyles.repResultTitle}>Cancel</Text>
              </Pressable>

              <Pressable
                style={exerciseStyles.saveProfileButton}
                onPress={saveProfile}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color={COLORS.white} />
                ) : (
                  <Text style={exerciseStyles.saveProfileButtonText}>
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
          style={exerciseStyles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={exerciseStyles.modalCard_Profile}>
            <ModalHeader
              title="Account Settings"
              onBack={closeSettings}
            />

            <Text style={exerciseStyles.fieldLabel}>Change password</Text>

            <TextInput
              style={exerciseStyles.input_Profile}
              value={currentPassword}
              onChangeText={setCurrentPassword}
              placeholder="Current password"
              placeholderTextColor={COLORS.gray}
              secureTextEntry
              autoCapitalize="none"
              editable={!saving}
            />

            <TextInput
              style={exerciseStyles.input_Profile}
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="New password"
              placeholderTextColor={COLORS.gray}
              secureTextEntry
              autoCapitalize="none"
              editable={!saving}
            />

            {error && (
              <Text style={exerciseStyles.errorText_Profile}>{error}</Text>
            )}

            <Pressable
              style={exerciseStyles.primaryModalButton}
              onPress={updatePassword}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <Text style={exerciseStyles.primaryModalText}>
                  Update password
                </Text>
              )}
            </Pressable>

            <Pressable
              style={exerciseStyles.deleteButton}
              onPress={confirmDeleteAccount}
              disabled={saving}
            >
              <Text style={exerciseStyles.deleteButtonText}>
                Delete account
              </Text>
            </Pressable>

            <Pressable
              style={exerciseStyles.closeButton}
              onPress={closeSettings}
              disabled={saving}
            >
              <Text style={exerciseStyles.repResultTitle}>Close</Text>
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
        <View style={exerciseStyles.deleteBackdrop}>
          <View style={exerciseStyles.card_Login_alert}>
            <View style={exerciseStyles.deleteIconCircle}>
              <Ionicons
                name="warning-outline"
                size={30}
                color={COLORS.error}
              />
            </View>

            <Text style={exerciseStyles.title_Login_alert}>
              Delete account?
            </Text>

            <Text style={exerciseStyles.message_Login_alert}>
              This will permanently delete your account and progress.
              This action cannot be undone.
            </Text>

            <TextInput
              style={exerciseStyles.deleteInput}
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
              <Text style={exerciseStyles.errorText_Profile}>{error}</Text>
            )}

            <View style={exerciseStyles.deleteConfirmActions}>
              <Pressable
                style={exerciseStyles.deleteCancelButton}
                onPress={() => {
                  setDeleteConfirmVisible(false);
                  setDeletePassword('');
                  setError(null);
                }}
                disabled={saving}
              >
                <Text style={exerciseStyles.repResultTitle}>Cancel</Text>
              </Pressable>

              <Pressable
                style={exerciseStyles.deleteConfirmButton}
                onPress={deleteAccount}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color={COLORS.white} />
                ) : (
                  <Text style={exerciseStyles.saveProfileButtonText}>
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
