import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, Pressable, Text, TextInput, View } from 'react-native';

import {
  loginUser,
  resetPassword,
  sendPasswordResetCode,
} from '@/services/firebase/authService';

import { COLORS } from '@/constants/appConstants';
import { exerciseStyles } from '@/constants/exerciseStyles';
import {
  closeAlert,
  type AlertDetails,
} from '@/screens/auth/alertUtils';

function TuneUpAlertModal({
  alert,
  onClose,
}: {
  alert: AlertDetails | null;
  onClose: () => void;
}) {
  const type = alert?.type ?? 'info';
  const iconName =
    type === 'success'
      ? 'checkmark-circle-outline'
      : type === 'error'
        ? 'alert-circle-outline'
        : 'information-circle-outline';

  return (
    <Modal
      visible={alert !== null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={exerciseStyles.backdrop}>
        <View style={exerciseStyles.card_Login_alert}>
          <View
            style={[
              exerciseStyles.deleteIconCircle,
              type === 'error' && exerciseStyles.selectedDropdownItem,
              type === 'success' && exerciseStyles.resultIconPassed,
            ]}
          >
            <Ionicons
              name={iconName}
              size={30}
              color={type === 'error' ? COLORS.error : COLORS.brown}
            />
          </View>

          <Text style={exerciseStyles.title_Login_alert}>{alert?.title}</Text>
          <Text style={exerciseStyles.message_Login_alert}>{alert?.message}</Text>

          <Pressable
            style={[
              exerciseStyles.button_Login_alert,
              type === 'error' && exerciseStyles.errorButton,
            ]}
            onPress={onClose}
            accessibilityRole="button"
          >
            <Text style={exerciseStyles.saveProfileButtonText}>
              {alert?.buttonLabel ?? 'Got it'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [alert, setAlert] = useState<AlertDetails | null>(null);

  async function handleLogin() {
    if (!email.trim() || !password) {
      setAlert({
        title: 'Missing information',
        message: 'Please enter your email and password.',
        type: 'info',
      });
      return;
    }

    try {
      setLoading(true);
      await loginUser(email, password);
      router.replace('/dashboard');
    } catch (error: any) {
      let message = 'Unable to log in.';
      switch (error?.code) {
        case 'auth/invalid-credential':
        case 'auth/wrong-password':
          message = 'Incorrect email or password.';
          break;
        case 'auth/user-not-found':
          message = 'No account was found with this email.';
          break;
        case 'auth/invalid-email':
          message = 'Please enter a valid email address.';
          break;
        case 'auth/network-request-failed':
          message = 'Network error. Please check your connection.';
          break;
        default:
          if (error instanceof Error) message = error.message;
      }
      setAlert({ title: 'Login failed', message, type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={exerciseStyles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={exerciseStyles.content_Login_forgotPassword}>
        <Image
          source={require('@/assets/images/tabIcons/tuneup-logo.png')}
          style={exerciseStyles.logo_Login_login}
          resizeMode="contain"
        />

        <View style={exerciseStyles.form_Login_login}>
          <Text style={exerciseStyles.label_Login_login}>Email Address</Text>
          <TextInput
            style={exerciseStyles.input_Login_login}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!loading}
          />

          <Text style={exerciseStyles.label_Login_login}>Password</Text>
          <View style={exerciseStyles.passwordContainer_Register}>
            <TextInput
              style={exerciseStyles.passwordInput_Login_login}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!loading}
            />
            <Pressable
              style={exerciseStyles.eyeButton}
              onPress={() => setShowPassword(previous => !previous)}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
            >
              <Text style={exerciseStyles.eyeText_Register}>{showPassword ? '◉' : '◌'}</Text>
            </Pressable>
          </View>

          <Pressable
            style={exerciseStyles.forgotButton}
            onPress={() => router.push('/forgot-password')}
            disabled={loading}
          >
            <Text style={exerciseStyles.forgotText}>Forgot Password?</Text>
          </Pressable>

          <Pressable
            style={[exerciseStyles.loginButton, loading && exerciseStyles.disabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={COLORS.brown} />
            ) : (
              <Text style={exerciseStyles.buttonText_Login_forgotPassword}>Log in</Text>
            )}
          </Pressable>

          <Pressable onPress={() => router.push('/register')} disabled={loading}>
            <Text style={exerciseStyles.signupText}>Create Account</Text>
          </Pressable>
        </View>
      </View>
      <TuneUpAlertModal
        alert={alert}
        onClose={() => closeAlert(alert, setAlert)}
      />
    </KeyboardAvoidingView>
  );
}

export function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState<AlertDetails | null>(null);

  async function handleSendCode() {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setAlert({
        title: 'Missing email',
        message: 'Please enter your email address.',
        type: 'info',
      });
      return;
    }

    try {
      setLoading(true);
      await sendPasswordResetCode(trimmedEmail);
      setAlert({
        title: 'Check your email',
        message: 'A password reset email has been sent to your email address.',
        type: 'success',
        buttonLabel: 'OK',
        onConfirm: () => router.back(),
      });
    } catch (error: any) {
      let message = 'Unable to send password reset email.';
      switch (error?.code) {
        case 'auth/invalid-email':
          message = 'Please enter a valid email address.';
          break;
        case 'auth/user-not-found':
          message = 'No account was found with this email.';
          break;
        case 'auth/network-request-failed':
          message = 'Network error. Please check your connection.';
          break;
        case 'auth/too-many-requests':
          message = 'Too many requests. Please try again later.';
          break;
        default:
          if (error instanceof Error) message = error.message;
      }
      setAlert({ title: 'Password Reset Failed', message, type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={exerciseStyles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={exerciseStyles.content_Login_forgotPassword}>
        <Pressable
          style={exerciseStyles.backButton_Login_forgotPassword}
          onPress={() => router.back()}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={exerciseStyles.backArrow}>‹</Text>
        </Pressable>

        <Text style={exerciseStyles.title_Login_forgotPassword}>Forgot Password?</Text>
        <Text style={exerciseStyles.label_Login_forgotPassword}>Email Address</Text>
        <TextInput
          style={exerciseStyles.input_Login_forgotPassword}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!loading}
          placeholder="Enter your email"
          placeholderTextColor={COLORS.muted}
        />

        <Pressable
          style={[exerciseStyles.sendButton, loading && exerciseStyles.disabled]}
          onPress={handleSendCode}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={COLORS.brown} />
          ) : (
            <Text style={exerciseStyles.buttonText_Login_forgotPassword}>Send</Text>
          )}
        </Pressable>
      </View>
      <TuneUpAlertModal
        alert={alert}
        onClose={() => closeAlert(alert, setAlert)}
      />
    </KeyboardAvoidingView>
  );
}

export function ResetPasswordScreen() {
  const params = useLocalSearchParams<{ code?: string }>();
  const code = Array.isArray(params.code) ? params.code[0] : params.code;
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [alert, setAlert] = useState<AlertDetails | null>(null);

  async function handleResetPassword() {
    if (!password || !confirmPassword) {
      setAlert({
        title: 'Missing information',
        message: 'Please enter your new password twice.',
        type: 'info',
      });
      return;
    }
    if (password.length < 6) {
      setAlert({
        title: 'Password too short',
        message: 'Your password must contain at least 6 characters.',
        type: 'info',
      });
      return;
    }
    if (password !== confirmPassword) {
      setAlert({
        title: 'Passwords do not match',
        message: 'Please make sure both passwords are the same.',
        type: 'error',
      });
      return;
    }
    if (!code) {
      setAlert({
        title: 'Invalid reset',
        message: 'The password reset code is missing or invalid.',
        type: 'error',
      });
      return;
    }

    try {
      setLoading(true);
      await resetPassword(code, password);
      setAlert({
        title: 'Password Reset',
        message: 'Your password has been successfully changed.',
        type: 'success',
        buttonLabel: 'Log in',
        onConfirm: () => router.replace('/login'),
      });
    } catch (error: any) {
      let message = 'Unable to reset your password.';
      switch (error?.code) {
        case 'auth/expired-action-code':
          message = 'This reset link has expired. Please request a new password reset email.';
          break;
        case 'auth/invalid-action-code':
          message = 'This reset link is invalid or has already been used.';
          break;
        case 'auth/weak-password':
          message = 'The password is too weak. Please choose a stronger password.';
          break;
        case 'auth/user-disabled':
          message = 'This account has been disabled.';
          break;
        case 'auth/network-request-failed':
          message = 'Network error. Please check your connection.';
          break;
        default:
          if (error instanceof Error) message = error.message;
      }
      setAlert({ title: 'Reset failed', message, type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={exerciseStyles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={exerciseStyles.content_Login_resetPassword}>
        <Image
          source={require('@/assets/images/tabIcons/tuneup-logo.png')}
          style={exerciseStyles.logo_Login_resetPassword}
          resizeMode="contain"
        />

        <View style={exerciseStyles.form_Login_login}>
          <Text style={exerciseStyles.label_Login_resetPassword}>Set New Password</Text>
          <View style={exerciseStyles.passwordContainer_Login_resetPassword}>
            <TextInput
              style={exerciseStyles.input_Login_resetPassword}
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
              style={exerciseStyles.eyeButton}
              onPress={() => setShowPassword(previous => !previous)}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
            >
              <Text style={exerciseStyles.eyeText_Login_resetPassword}>{showPassword ? '◉' : '◌'}</Text>
            </Pressable>
          </View>

          <Text style={exerciseStyles.label_Login_resetPassword}>Confirm New Password</Text>
          <View style={exerciseStyles.passwordContainer_Login_resetPassword}>
            <TextInput
              style={exerciseStyles.input_Login_resetPassword}
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
              style={exerciseStyles.eyeButton}
              onPress={() => setShowConfirmPassword(previous => !previous)}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel={showConfirmPassword ? 'Hide password' : 'Show password'}
            >
              <Text style={exerciseStyles.eyeText_Login_resetPassword}>{showConfirmPassword ? '◉' : '◌'}</Text>
            </Pressable>
          </View>

          <Pressable
            style={[exerciseStyles.resetButton, loading && exerciseStyles.disabled]}
            onPress={handleResetPassword}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={COLORS.brown} />
            ) : (
              <Text style={exerciseStyles.difficultyText}>Reset Password</Text>
            )}
          </Pressable>
        </View>
      </View>
      <TuneUpAlertModal
        alert={alert}
        onClose={() => closeAlert(alert, setAlert)}
      />
    </KeyboardAvoidingView>
  );
}