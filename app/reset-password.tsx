import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';

import { resetPassword } from '@/services/firebase/authService';

export default function ResetPasswordScreen() {
  const params = useLocalSearchParams<{
    code?: string;
  }>();

  const code = Array.isArray(params.code)
    ? params.code[0]
    : params.code;

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] =
    useState('');

  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] =
    useState(false);

  const [showConfirmPassword, setShowConfirmPassword] =
    useState(false);

  async function handleResetPassword() {
    if (!password || !confirmPassword) {
      Alert.alert(
        'Missing information',
        'Please enter your new password twice.',
      );
      return;
    }

    if (password.length < 6) {
      Alert.alert(
        'Password too short',
        'Your password must contain at least 6 characters.',
      );
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert(
        'Passwords do not match',
        'Please make sure both passwords are the same.',
      );
      return;
    }

    if (!code) {
      Alert.alert(
        'Invalid reset',
        'The password reset code is missing or invalid.',
      );
      return;
    }

    try {
      setLoading(true);

      await resetPassword(code, password);

      Alert.alert(
        'Password Reset',
        'Your password has been successfully changed.',
        [
          {
            text: 'Log in',
            onPress: () => router.replace('/login'),
          },
        ],
      );
    } catch (error: any) {
      let message =
        'Unable to reset your password.';

      switch (error?.code) {
        case 'auth/expired-action-code':
          message =
            'This reset link has expired. Please request a new password reset email.';
          break;

        case 'auth/invalid-action-code':
          message =
            'This reset link is invalid or has already been used.';
          break;

        case 'auth/weak-password':
          message =
            'The password is too weak. Please choose a stronger password.';
          break;

        case 'auth/user-disabled':
          message =
            'This account has been disabled.';
          break;

        case 'auth/network-request-failed':
          message =
            'Network error. Please check your connection.';
          break;

        default:
          if (error instanceof Error) {
            message = error.message;
          }
      }

      Alert.alert(
        'Reset failed',
        message,
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={
        Platform.OS === 'ios'
          ? 'padding'
          : undefined
      }
    >
      <View style={styles.content}>

        {/* Back Button */}
        <Pressable
          style={styles.backButton}
          onPress={() => router.back()}
          disabled={loading}
        >
          <Text style={styles.backArrow}>
            ‹
          </Text>
        </Pressable>

        {/* TuneUp Logo */}
        <Image
          source={require('@/assets/images/tuneup-logo.png')}
          style={styles.logo}
          resizeMode="contain"
        />

        <View style={styles.form}>

          {/* Set New Password */}
          <Text style={styles.label}>
            Set New Password
          </Text>

          <View style={styles.passwordContainer}>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!loading}
              placeholder="Enter new password"
              placeholderTextColor="#A99C9A"
            />

            <Pressable
              style={styles.eyeButton}
              onPress={() =>
                setShowPassword(
                  previous => !previous,
                )
              }
              disabled={loading}
            >
              <Text style={styles.eyeText}>
                {showPassword ? '◉' : '◌'}
              </Text>
            </Pressable>
          </View>

          {/* Confirm New Password */}
          <Text style={styles.label}>
            Confirm New Password
          </Text>

          <View style={styles.passwordContainer}>
            <TextInput
              style={styles.input}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry={!showConfirmPassword}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!loading}
              placeholder="Confirm new password"
              placeholderTextColor="#A99C9A"
            />

            <Pressable
              style={styles.eyeButton}
              onPress={() =>
                setShowConfirmPassword(
                  previous => !previous,
                )
              }
              disabled={loading}
            >
              <Text style={styles.eyeText}>
                {showConfirmPassword ? '◉' : '◌'}
              </Text>
            </Pressable>
          </View>

          {/* Reset Password */}
          <Pressable
            style={[
              styles.resetButton,
              loading && styles.disabledButton,
            ]}
            onPress={handleResetPassword}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator
                color="#4A302F"
              />
            ) : (
              <Text style={styles.buttonText}>
                Reset Password
              </Text>
            )}
          </Pressable>

        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },

  content: {
    flex: 1,
    paddingHorizontal: 22,
    justifyContent: 'center',
  },

  backButton: {
    position: 'absolute',
    top: 42,
    left: 20,
    width: 35,
    height: 35,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },

  backArrow: {
    fontSize: 28,
    fontWeight: '300',
    color: '#4A302F',
  },

  logo: {
    width: 125,
    height: 125,
    alignSelf: 'center',
    marginBottom: 70,
  },

  form: {
    width: '100%',
  },

  label: {
    fontSize: 9,
    color: '#4A302F',
    marginBottom: 6,
  },

  passwordContainer: {
    position: 'relative',
    width: '100%',
    marginBottom: 12,
  },

  input: {
    width: '100%',
    height: 42,
    backgroundColor: '#F5F3F3',
    borderRadius: 3,
    paddingHorizontal: 12,
    paddingRight: 42,
    fontSize: 12,
    color: '#3F2B2A',
  },

  eyeButton: {
    position: 'absolute',
    right: 8,
    top: 0,
    width: 34,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },

  eyeText: {
    fontSize: 15,
    color: '#8B7C7B',
  },

  resetButton: {
    width: 110,
    height: 34,
    borderRadius: 18,
    backgroundColor: '#F8CBD4',
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },

  disabledButton: {
    opacity: 0.6,
  },

  buttonText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#4A302F',
  },
});