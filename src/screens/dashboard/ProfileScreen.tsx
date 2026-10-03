import AppHeader from '@/components/appheader';
import { useAuth } from '@/hooks/useAuth';
import { useProgress } from '@/hooks/useProgress';
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

import {
  changeCurrentPassword,
  deleteCurrentAccount,
  logoutUser,
  updateCurrentUserProfile,
} from '@/services/firebase/authService';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_GRAY = '#F7F7F7';
const WHITE = '#FFFFFF';
const RED = '#FF5A5F';

export default function ProfileScreen() {
  const {
    userName,
    userPhotoURL,
  } = useAuth();
  const {
    summaries: progressSummaries,
    loading: progressLoading,
  } = useProgress();

  const displayName = userName.trim() || 'Singer';

  const tierRank = {
    beginner: 0,
    intermediate: 1,
    advanced: 2,
  } as const;

  const overallTier = progressSummaries.reduce(
    (highestTier, summary) =>
      tierRank[summary.currentTier] >
      tierRank[highestTier]
        ? summary.currentTier
        : highestTier,
    'beginner' as keyof typeof tierRank,
  );

  const formattedTier =
    overallTier.charAt(0).toUpperCase() +
    overallTier.slice(1);

  const [editVisible, setEditVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [nameDraft, setNameDraft] = useState(displayName);
  const [profileName, setProfileName] = useState(displayName);
  const [photoDraft, setPhotoDraft] = useState<string | null>(
    userPhotoURL,
  );
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNameDraft(displayName);
    setProfileName(displayName);
    setPhotoDraft(userPhotoURL);
  }, [displayName, userPhotoURL]);

  const pickPhoto = async () => {
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
    }
  };

  const saveProfile = async () => {
    setSaving(true);
    setError(null);

    try {
      await updateCurrentUserProfile(
        nameDraft,
        photoDraft,
      );
      setProfileName(nameDraft.trim());
      setEditVisible(false);
    } catch (saveError: any) {
      setError(saveError?.message ?? 'Unable to update your profile.');
    } finally {
      setSaving(false);
    }
  };

  const updatePassword = async () => {
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await changeCurrentPassword(
        currentPassword,
        newPassword,
      );
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSettingsVisible(false);
      Alert.alert('Password updated', 'Your password has been changed.');
    } catch (passwordError: any) {
      setError(passwordError?.message ?? 'Unable to change your password.');
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteAccount = () => {
    Alert.alert(
      'Delete account?',
      'This permanently deletes your account and progress.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: deleteAccount,
        },
      ],
    );
  };

  const deleteAccount = async () => {
    setSaving(true);
    setError(null);

    try {
      await deleteCurrentAccount(currentPassword);
      setSettingsVisible(false);
      router.replace('/login');
    } catch (deleteError: any) {
      setError(deleteError?.message ?? 'Unable to delete your account.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.screen}>
      <AppHeader />

      <View style={styles.content}>

        <View style={styles.profileSection}>
          <Image
            source={
              photoDraft
                ? { uri: photoDraft }
                : require('@/assets/images/tabIcons/profile.png')
            }
            style={styles.avatar}
            resizeMode="cover"
          />

          <Text style={styles.name}>
            {profileName}
          </Text>

          <Text style={styles.tier}>
            {progressLoading
              ? 'Loading tier...'
              : `${formattedTier} tier`}
          </Text>

          <Pressable
            style={styles.editButton}
            onPress={() => {
              setError(null);
              setEditVisible(true);
            }}
          >
            <Text style={styles.editText}>
              Edit Profile
            </Text>
          </Pressable>
        </View>

        <View style={styles.optionsContainer}>

          {/* ACCOUNT SETTINGS */}
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
                color="#A5A5A5"
              />
            </View>

            <Text style={styles.optionText}>
              Account Settings
            </Text>

            <Ionicons
              name="chevron-forward"
              size={22}
              color="#A5A5A5"
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
                color="#52B788"
              />
            </View>

            <Text style={styles.optionText}>
              View Progress
            </Text>

            <Ionicons
              name="chevron-forward"
              size={22}
              color="#A5A5A5"
            />
          </Pressable>

        </View>

        {/* LOG OUT */}
        <Pressable
          style={styles.logoutButton}
          onPress={logoutUser}
        >
          <Text style={styles.logoutText}>
            Log out
          </Text>
        </Pressable>

      </View>

      <Modal
        visible={editVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setEditVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit Profile</Text>

            <Pressable style={styles.photoPicker} onPress={pickPhoto}>
              <Image
                source={
                  photoDraft
                    ? { uri: photoDraft }
                    : require('@/assets/images/tabIcons/profile.png')
                }
                style={styles.modalAvatar}
              />
              <Text style={styles.photoPickerText}>Change photo</Text>
            </Pressable>

            <TextInput
              style={styles.input}
              value={nameDraft}
              onChangeText={setNameDraft}
              placeholder="Your name"
              placeholderTextColor="#A5A5A5"
              autoCapitalize="words"
            />

            {error && <Text style={styles.errorText}>{error}</Text>}

            <View style={styles.modalActions}>
              <Pressable
                style={styles.cancelButton}
                onPress={() => setEditVisible(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>

              <Pressable
                style={styles.primaryModalButton}
                onPress={saveProfile}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color={WHITE} />
                ) : (
                  <Text style={styles.primaryModalText}>Save</Text>
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
        onRequestClose={() => setSettingsVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Account Settings</Text>

            <Text style={styles.fieldLabel}>Change password</Text>

            <TextInput
              style={styles.input}
              value={currentPassword}
              onChangeText={setCurrentPassword}
              placeholder="Current password"
              placeholderTextColor="#A5A5A5"
              secureTextEntry
            />

            <TextInput
              style={styles.input}
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="New password"
              placeholderTextColor="#A5A5A5"
              secureTextEntry
            />

            <TextInput
              style={styles.input}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Confirm new password"
              placeholderTextColor="#A5A5A5"
              secureTextEntry
            />

            {error && <Text style={styles.errorText}>{error}</Text>}

            <Pressable
              style={styles.primaryModalButton}
              onPress={updatePassword}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color={WHITE} />
              ) : (
                <Text style={styles.primaryModalText}>Update password</Text>
              )}
            </Pressable>

            <Pressable
              style={styles.deleteButton}
              onPress={confirmDeleteAccount}
              disabled={saving}
            >
              <Text style={styles.deleteButtonText}>Delete account</Text>
            </Pressable>

            <Pressable
              style={styles.cancelButton}
              onPress={() => setSettingsVisible(false)}
            >
              <Text style={styles.cancelButtonText}>Close</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: WHITE,
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

    backgroundColor: PINK,

    marginBottom: 10,
  },

  name: {
    fontFamily: 'FredokaBold',
    fontSize: 21,

    color: BROWN,

    marginBottom: 8,
  },

  tier: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: '#8E7770',
    marginBottom: 8,
  },

  editButton: {
    minWidth: 84,
    height: 22,

    paddingHorizontal: 14,

    borderRadius: 12,

    backgroundColor: PINK,

    alignItems: 'center',
    justifyContent: 'center',

    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 2,
    shadowOffset: {
      width: 0,
      height: 1,
    },

    elevation: 2,
  },

  editText: {
    fontFamily: 'FredokaBold',
    fontSize: 8,

    color: BROWN,
  },

  optionsContainer: {
    width: '100%',

    gap: 18,
  },

  optionCard: {
    width: '100%',
    height: 68,

    backgroundColor: LIGHT_GRAY,

    borderRadius: 17,

    paddingHorizontal: 24,

    flexDirection: 'row',
    alignItems: 'center',

    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: {
      width: 0,
      height: 2,
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

    color: BROWN,
  },

  logoutButton: {
    width: 107,
    height: 38,

    borderRadius: 20,

    backgroundColor: RED,

    alignItems: 'center',
    justifyContent: 'center',

    marginTop: 70,

    shadowColor: '#000',
    shadowOpacity: 0.10,
    shadowRadius: 4,
    shadowOffset: {
      width: 0,
      height: 2,
    },

    elevation: 3,
  },

  logoutText: {
    fontFamily: 'FredokaBold',
    fontSize: 14,

    color: WHITE,
  },

  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(78, 47, 31, 0.28)',
  },

  modalCard: {
    backgroundColor: WHITE,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 34,
  },

  modalTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 22,
    color: BROWN,
    marginBottom: 18,
  },

  photoPicker: {
    alignItems: 'center',
    marginBottom: 16,
  },

  modalAvatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: PINK,
    marginBottom: 7,
  },

  photoPickerText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
    color: BROWN,
  },

  fieldLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 13,
    color: BROWN,
    marginBottom: 8,
  },

  input: {
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5D8D3',
    paddingHorizontal: 14,
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    color: BROWN,
    marginBottom: 10,
  },

  errorText: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: '#B84A4A',
    marginBottom: 10,
  },

  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },

  cancelButton: {
    flex: 1,
    height: 46,
    borderRadius: 23,
    backgroundColor: LIGHT_GRAY,
    alignItems: 'center',
    justifyContent: 'center',
  },

  cancelButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 14,
    color: BROWN,
  },

  primaryModalButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 23,
    backgroundColor: BROWN,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    marginBottom: 10,
  },

  primaryModalText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 14,
    color: WHITE,
    textAlign: 'center',
  },

  deleteButton: {
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFF0F0',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },

  deleteButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 14,
    color: RED,
  },
});