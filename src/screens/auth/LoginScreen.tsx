import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
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
  loginUser,
  resetPassword,
  sendPasswordResetCode,
} from '@/services/firebase/authService';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF0F3';
const WHITE = '#FFFFFF';
const RED = '#FF5A5F';
const MUTED = '#8E7770';
const BORDER = '#F0E8E5';
const LIGHT_GRAY = '#F7F7F7';

type AlertType = 'success' | 'error' | 'info';

type AlertDetails = {
  title: string;
  message: string;
  type: AlertType;
  buttonLabel?: string;
  onConfirm?: () => void;
};

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
      <View style={alertStyles.backdrop}>
        <View style={alertStyles.card}>
          <View
            style={[
              alertStyles.iconCircle,
              type === 'error' && alertStyles.errorIconCircle,
              type === 'success' && alertStyles.successIconCircle,
            ]}
          >
            <Ionicons
              name={iconName}
              size={30}
              color={type === 'error' ? RED : BROWN}
            />
          </View>

          <Text style={alertStyles.title}>{alert?.title}</Text>
          <Text style={alertStyles.message}>{alert?.message}</Text>

          <Pressable
            style={[
              alertStyles.button,
              type === 'error' && alertStyles.errorButton,
            ]}
            onPress={onClose}
            accessibilityRole="button"
          >
            <Text style={alertStyles.buttonText}>
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

  function closeAlert() {
    const callback = alert?.onConfirm;
    setAlert(null);
    callback?.();
  }

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
      style={loginStyles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={loginStyles.content}>
        <Image
          source={require('@/assets/images/tabIcons/tuneup-logo.png')}
          style={loginStyles.logo}
          resizeMode="contain"
        />

        <View style={loginStyles.form}>
          <Text style={loginStyles.label}>Email Address</Text>
          <TextInput
            style={loginStyles.input}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!loading}
          />

          <Text style={loginStyles.label}>Password</Text>
          <View style={loginStyles.passwordContainer}>
            <TextInput
              style={loginStyles.passwordInput}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!loading}
            />
            <Pressable
              style={loginStyles.eyeButton}
              onPress={() => setShowPassword(previous => !previous)}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
            >
              <Text style={loginStyles.eyeText}>{showPassword ? '◉' : '◌'}</Text>
            </Pressable>
          </View>

          <Pressable
            style={loginStyles.forgotButton}
            onPress={() => router.push('/forgot-password')}
            disabled={loading}
          >
            <Text style={loginStyles.forgotText}>Forgot Password?</Text>
          </Pressable>

          <Pressable
            style={[loginStyles.loginButton, loading && loginStyles.disabledButton]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={BROWN} />
            ) : (
              <Text style={loginStyles.buttonText}>Log in</Text>
            )}
          </Pressable>

          <Pressable onPress={() => router.push('/register')} disabled={loading}>
            <Text style={loginStyles.signupText}>Create Account</Text>
          </Pressable>
        </View>
      </View>
      <TuneUpAlertModal alert={alert} onClose={closeAlert} />
    </KeyboardAvoidingView>
  );
}

const loginStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: WHITE },
  content: { flex: 1, paddingHorizontal: 26, justifyContent: 'center' },
  logo: { width: 125, height: 125, alignSelf: 'center', marginBottom: 72 },
  form: { width: '100%' },
  label: { fontSize: 10, color: '#4A302F', marginBottom: 6 },
  input: {
    height: 42, backgroundColor: '#F5F3F3', borderRadius: 3,
    paddingHorizontal: 12, fontSize: 13, color: '#3F2B2A', marginBottom: 14,
  },
  passwordContainer: { position: 'relative', width: '100%' },
  passwordInput: {
    height: 42, backgroundColor: '#F5F3F3', borderRadius: 3,
    paddingHorizontal: 12, paddingRight: 42, fontSize: 13,
    color: '#3F2B2A', marginBottom: 14,
  },
  eyeButton: {
    position: 'absolute', right: 8, top: 0, width: 34, height: 42,
    alignItems: 'center', justifyContent: 'center',
  },
  eyeText: { fontSize: 16, color: '#8B7C7B' },
  forgotButton: { alignSelf: 'flex-end', marginTop: -5, marginBottom: 38 },
  forgotText: { fontSize: 8, color: '#8B7C7B', textDecorationLine: 'underline' },
  loginButton: {
    width: 68, height: 34, borderRadius: 18, backgroundColor: '#F8CBD4',
    alignSelf: 'center', alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  disabledButton: { opacity: 0.6 },
  buttonText: { fontSize: 11, fontFamily: 'FredokaBold', color: '#4A302F' },
  signupText: {
    textAlign: 'center', fontSize: 8, color: '#7D6D6B', textDecorationLine: 'underline',
  },
});

export function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState<AlertDetails | null>(null);

  function closeAlert() {
    const callback = alert?.onConfirm;
    setAlert(null);
    callback?.();
  }

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
      style={forgotPasswordStyles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={forgotPasswordStyles.content}>
        <Pressable
          style={forgotPasswordStyles.backButton}
          onPress={() => router.back()}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={forgotPasswordStyles.backArrow}>‹</Text>
        </Pressable>

        <Text style={forgotPasswordStyles.title}>Forgot Password?</Text>
        <Text style={forgotPasswordStyles.label}>Email Address</Text>
        <TextInput
          style={forgotPasswordStyles.input}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!loading}
          placeholder="Enter your email"
          placeholderTextColor="#A99C9A"
        />

        <Pressable
          style={[forgotPasswordStyles.sendButton, loading && forgotPasswordStyles.disabledButton]}
          onPress={handleSendCode}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={BROWN} />
          ) : (
            <Text style={forgotPasswordStyles.buttonText}>Send</Text>
          )}
        </Pressable>
      </View>
      <TuneUpAlertModal alert={alert} onClose={closeAlert} />
    </KeyboardAvoidingView>
  );
}

const forgotPasswordStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: WHITE },
  content: { flex: 1, paddingHorizontal: 26, justifyContent: 'center' },
  backButton: {
    position: 'absolute', top: 45, left: 20, width: 40, height: 40,
    alignItems: 'center', justifyContent: 'center', zIndex: 10,
  },
  backArrow: { fontSize: 32, fontFamily: 'FredokaLight', color: '#4A302F' },
  title: {
    textAlign: 'center', fontSize: 22, fontFamily: 'FredokaBold', color: '#4A302F', marginBottom: 12,
  },
  description: { textAlign: 'center', fontSize: 11, lineHeight: 17, color: '#7D6D6B', marginBottom: 35 },
  label: { fontSize: 10, color: '#4A302F', marginBottom: 6 },
  input: {
    height: 42, backgroundColor: '#F5F3F3', borderRadius: 3,
    paddingHorizontal: 12, fontSize: 13, color: '#3F2B2A', marginBottom: 28,
  },
  sendButton: {
    width: 80, height: 36, borderRadius: 18, backgroundColor: '#F8CBD4',
    alignSelf: 'center', alignItems: 'center', justifyContent: 'center',
  },
  disabledButton: { opacity: 0.6 },
  buttonText: { fontSize: 11, fontFamily: 'FredokaBold', color: '#4A302F' },
});

export function ResetPasswordScreen() {
  const params = useLocalSearchParams<{ code?: string }>();
  const code = Array.isArray(params.code) ? params.code[0] : params.code;
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [alert, setAlert] = useState<AlertDetails | null>(null);

  function closeAlert() {
    const callback = alert?.onConfirm;
    setAlert(null);
    callback?.();
  }

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
      style={resetPasswordStyles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={resetPasswordStyles.content}>
        <Image
          source={require('@/assets/images/tabIcons/tuneup-logo.png')}
          style={resetPasswordStyles.logo}
          resizeMode="contain"
        />

        <View style={resetPasswordStyles.form}>
          <Text style={resetPasswordStyles.label}>Set New Password</Text>
          <View style={resetPasswordStyles.passwordContainer}>
            <TextInput
              style={resetPasswordStyles.input}
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
              style={resetPasswordStyles.eyeButton}
              onPress={() => setShowPassword(previous => !previous)}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
            >
              <Text style={resetPasswordStyles.eyeText}>{showPassword ? '◉' : '◌'}</Text>
            </Pressable>
          </View>

          <Text style={resetPasswordStyles.label}>Confirm New Password</Text>
          <View style={resetPasswordStyles.passwordContainer}>
            <TextInput
              style={resetPasswordStyles.input}
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
              style={resetPasswordStyles.eyeButton}
              onPress={() => setShowConfirmPassword(previous => !previous)}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel={showConfirmPassword ? 'Hide password' : 'Show password'}
            >
              <Text style={resetPasswordStyles.eyeText}>{showConfirmPassword ? '◉' : '◌'}</Text>
            </Pressable>
          </View>

          <Pressable
            style={[resetPasswordStyles.resetButton, loading && resetPasswordStyles.disabledButton]}
            onPress={handleResetPassword}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={BROWN} />
            ) : (
              <Text style={resetPasswordStyles.buttonText}>Reset Password</Text>
            )}
          </Pressable>
        </View>
      </View>
      <TuneUpAlertModal alert={alert} onClose={closeAlert} />
    </KeyboardAvoidingView>
  );
}

const resetPasswordStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: WHITE },
  content: { flex: 1, paddingHorizontal: 22, justifyContent: 'center' },
  logo: { width: 125, height: 125, alignSelf: 'center', marginBottom: 70 },
  form: { width: '100%' },
  label: { fontSize: 9, color: '#4A302F', marginBottom: 6 },
  passwordContainer: { position: 'relative', width: '100%', marginBottom: 12 },
  input: {
    width: '100%', height: 42, backgroundColor: '#F5F3F3', borderRadius: 3,
    paddingHorizontal: 12, paddingRight: 42, fontSize: 12, color: '#3F2B2A',
  },
  eyeButton: {
    position: 'absolute', right: 8, top: 0, width: 34, height: 42,
    alignItems: 'center', justifyContent: 'center',
  },
  eyeText: { fontSize: 15, color: '#8B7C7B' },
  resetButton: {
    width: 110, height: 34, borderRadius: 18, backgroundColor: '#F8CBD4',
    alignSelf: 'center', alignItems: 'center', justifyContent: 'center', marginTop: 20,
  },
  disabledButton: { opacity: 0.6 },
  buttonText: { fontSize: 9, fontFamily: 'FredokaBold', color: '#4A302F' },
});

const alertStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(220, 220, 220, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: WHITE,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER,
  },
  iconCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: LIGHT_PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  errorIconCircle: { backgroundColor: '#FFF0F0' },
  successIconCircle: { backgroundColor: PINK },
  title: {
    fontFamily: 'FredokaBold',
    fontSize: 22,
    color: BROWN,
    textAlign: 'center',
    marginBottom: 10,
  },
  message: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    color: MUTED,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 24,
  },
  button: {
    width: '100%',
    minHeight: 46,
    borderRadius: 23,
    backgroundColor: BROWN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorButton: { backgroundColor: RED },
  buttonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 14,
    color: WHITE,
  },
});
