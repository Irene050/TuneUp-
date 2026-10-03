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

import {
  loginUser,
  resetPassword,
  sendPasswordResetCode,
} from '@/services/firebase/authService';

export function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleLogin() {
    if (!email.trim() || !password) {
      Alert.alert(
        'Missing information',
        'Please enter your email and password.',
      );
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
          message = 'Incorrect email or password.';
          break;

        case 'auth/user-not-found':
          message = 'No account was found with this email.';
          break;

        case 'auth/wrong-password':
          message = 'Incorrect email or password.';
          break;

        case 'auth/invalid-email':
          message = 'Please enter a valid email address.';
          break;

        case 'auth/network-request-failed':
          message = 'Network error. Please check your connection.';
          break;

        default:
          if (error instanceof Error) {
            message = error.message;
          }
      }

      Alert.alert('Login failed', message);
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

        {/* TuneUp Logo */}
        <Image
          source={require('@/assets/images/tabIcons/tuneup-logo.png')}
          style={loginStyles.logo}
          resizeMode="contain"
        />

        <View style={loginStyles.form}>

          {/* Email Address */}
          <Text style={loginStyles.label}>
            Email Address
          </Text>

          <TextInput
            style={loginStyles.input}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!loading}
          />

          {/* Password */}
          <Text style={loginStyles.label}>
            Password
          </Text>

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

            {/* Eye Toggle */}
            <Pressable
              style={loginStyles.eyeButton}
              onPress={() =>
                setShowPassword((previous) => !previous)
              }
              disabled={loading}
            >
              <Text style={loginStyles.eyeText}>
                {showPassword ? '◉' : '◌'}
              </Text>
            </Pressable>
          </View>


          <Pressable
            style={loginStyles.forgotButton}
            onPress={() => router.push('/forgot-password')}
            disabled={loading}
          >
            <Text style={loginStyles.forgotText}>
              Forgot Password?
            </Text>
          </Pressable>

         
          <Pressable
            style={[
              loginStyles.loginButton,
              loading && loginStyles.disabledButton,
            ]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#4A302F" />
            ) : (
              <Text style={loginStyles.buttonText}>
                Log in
              </Text>
            )}
          </Pressable>

        
          <Pressable
            onPress={() => router.push('/register')}
            disabled={loading}
          >
            <Text style={loginStyles.signupText}>
              Create Account
            </Text>
          </Pressable>

        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const loginStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },

  content: {
    flex: 1,
    paddingHorizontal: 26,
    justifyContent: 'center',
  },

  logo: {
    width: 125,
    height: 125,
    alignSelf: 'center',
    marginBottom: 72,
  },

  form: {
    width: '100%',
  },

  label: {
    fontSize: 10,
    color: '#4A302F',
    marginBottom: 6,
  },

  input: {
    height: 42,
    backgroundColor: '#F5F3F3',
    borderRadius: 3,
    paddingHorizontal: 12,
    fontSize: 13,
    color: '#3F2B2A',
    marginBottom: 14,
  },

  passwordContainer: {
    position: 'relative',
    width: '100%',
  },

  passwordInput: {
    height: 42,
    backgroundColor: '#F5F3F3',
    borderRadius: 3,
    paddingHorizontal: 12,
    paddingRight: 42,
    fontSize: 13,
    color: '#3F2B2A',
    marginBottom: 14,
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
    fontSize: 16,
    color: '#8B7C7B',
  },

  forgotButton: {
    alignSelf: 'flex-end',
    marginTop: -5,
    marginBottom: 38,
  },

  forgotText: {
    fontSize: 8,
    color: '#8B7C7B',
    textDecorationLine: 'underline',
  },

  loginButton: {
    width: 68,
    height: 34,
    borderRadius: 18,
    backgroundColor: '#F8CBD4',
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },

  disabledButton: {
    opacity: 0.6,
  },

  buttonText: {
    fontSize: 11,
    fontFamily: 'FredokaBold',
    color: '#4A302F',
  },

  signupText: {
    textAlign: 'center',
    fontSize: 8,
    color: '#7D6D6B',
    textDecorationLine: 'underline',
  },
});

export function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSendCode() {
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedEmail) {
      Alert.alert(
        'Missing email',
        'Please enter your email address.',
      );
      return;
    }

    try {
      setLoading(true);

      // Send Firebase password reset email
      await sendPasswordResetCode(trimmedEmail);

      Alert.alert(
        'Check your email',
        'A password reset email has been sent to your email address.',
        [
          {
            text: 'OK',
            onPress: () => router.back(),
          },
        ],
      );
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
          message =
            'Network error. Please check your connection.';
          break;

        case 'auth/too-many-requests':
          message =
            'Too many requests. Please try again later.';
          break;

        default:
          if (error instanceof Error) {
            message = error.message;
          }
      }

      Alert.alert(
        'Password Reset Failed',
        message,
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={forgotPasswordStyles.container}
      behavior={
        Platform.OS === 'ios'
          ? 'padding'
          : undefined
      }
    >
      <View style={forgotPasswordStyles.content}>

        {/* Back Button */}
        <Pressable
          style={forgotPasswordStyles.backButton}
          onPress={() => router.back()}
          disabled={loading}
        >
          <Text style={forgotPasswordStyles.backArrow}>‹</Text>
        </Pressable>

        {/* Title */}
        <Text style={forgotPasswordStyles.title}>
          Forgot Password?
        </Text>

        {/* Description */}
        <Text style={forgotPasswordStyles.description}>
          Enter your email address and we will send you
          a password reset email.
        </Text>

        {/* Email */}
        <Text style={forgotPasswordStyles.label}>
          Email Address
        </Text>

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

        {/* Send Button */}
        <Pressable
          style={[
            forgotPasswordStyles.sendButton,
            loading && forgotPasswordStyles.disabledButton,
          ]}
          onPress={handleSendCode}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#4A302F" />
          ) : (
            <Text style={forgotPasswordStyles.buttonText}>
              Send
            </Text>
          )}
        </Pressable>

      </View>
    </KeyboardAvoidingView>
  );
}

const forgotPasswordStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },

  content: {
    flex: 1,
    paddingHorizontal: 26,
    justifyContent: 'center',
  },

  /* Back Arrow */
  backButton: {
    position: 'absolute',
    top: 45,
    left: 20,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },

  backArrow: {
    fontSize: 32,
    fontFamily: 'FredokaLight',
    color: '#4A302F',
  },

  title: {
    textAlign: 'center',
    fontSize: 22,
    fontFamily: 'FredokaBold',
    color: '#4A302F',
    marginBottom: 12,
  },

  description: {
    textAlign: 'center',
    fontSize: 11,
    lineHeight: 17,
    color: '#7D6D6B',
    marginBottom: 35,
  },

  label: {
    fontSize: 10,
    color: '#4A302F',
    marginBottom: 6,
  },

  input: {
    height: 42,
    backgroundColor: '#F5F3F3',
    borderRadius: 3,
    paddingHorizontal: 12,
    fontSize: 13,
    color: '#3F2B2A',
    marginBottom: 28,
  },

  sendButton: {
    width: 80,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F8CBD4',
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },

  disabledButton: {
    opacity: 0.6,
  },

  buttonText: {
    fontSize: 11,
    fontFamily: 'FredokaBold',
    color: '#4A302F',
  },
});

export function ResetPasswordScreen() {
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
      style={resetPasswordStyles.container}
      behavior={
        Platform.OS === 'ios'
          ? 'padding'
          : undefined
      }
    >
      <View style={resetPasswordStyles.content}>

        {/* Back Button */}
        <Pressable
          style={resetPasswordStyles.backButton}
          onPress={() => router.back()}
          disabled={loading}
        >
          <Text style={resetPasswordStyles.backArrow}>
            ‹
          </Text>
        </Pressable>

        {/* TuneUp Logo */}
        <Image
          source={require('@/assets/images/tabIcons/tuneup-logo.png')}
          style={resetPasswordStyles.logo}
          resizeMode="contain"
        />

        <View style={resetPasswordStyles.form}>

          {/* Set New Password */}
          <Text style={resetPasswordStyles.label}>
            Set New Password
          </Text>

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
              onPress={() =>
                setShowPassword(
                  previous => !previous,
                )
              }
              disabled={loading}
            >
              <Text style={resetPasswordStyles.eyeText}>
                {showPassword ? '◉' : '◌'}
              </Text>
            </Pressable>
          </View>

          {/* Confirm New Password */}
          <Text style={resetPasswordStyles.label}>
            Confirm New Password
          </Text>

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
              onPress={() =>
                setShowConfirmPassword(
                  previous => !previous,
                )
              }
              disabled={loading}
            >
              <Text style={resetPasswordStyles.eyeText}>
                {showConfirmPassword ? '◉' : '◌'}
              </Text>
            </Pressable>
          </View>

          {/* Reset Password */}
          <Pressable
            style={[
              resetPasswordStyles.resetButton,
              loading && resetPasswordStyles.disabledButton,
            ]}
            onPress={handleResetPassword}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator
                color="#4A302F"
              />
            ) : (
              <Text style={resetPasswordStyles.buttonText}>
                Reset Password
              </Text>
            )}
          </Pressable>

        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const resetPasswordStyles = StyleSheet.create({
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
    fontFamily: 'FredokaLight',
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
    fontFamily: 'FredokaBold',
    color: '#4A302F',
  },
});