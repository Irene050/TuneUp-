import { router } from 'expo-router';
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

import { loginUser } from '@/services/firebase/authService';

export default function LoginScreen() {
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
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.content}>

        {/* TuneUp Logo */}
        <Image
          source={require('@/assets/images/tuneup-logo.png')}
          style={styles.logo}
          resizeMode="contain"
        />

        <View style={styles.form}>

          {/* Email Address */}
          <Text style={styles.label}>
            Email Address
          </Text>

          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!loading}
          />

          {/* Password */}
          <Text style={styles.label}>
            Password
          </Text>

          <View style={styles.passwordContainer}>
            <TextInput
              style={styles.passwordInput}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!loading}
            />

            {/* Eye Toggle */}
            <Pressable
              style={styles.eyeButton}
              onPress={() =>
                setShowPassword((previous) => !previous)
              }
              disabled={loading}
            >
              <Text style={styles.eyeText}>
                {showPassword ? '◉' : '◌'}
              </Text>
            </Pressable>
          </View>


          <Pressable
            style={styles.forgotButton}
            onPress={() => router.push('/forgot-password')}
            disabled={loading}
          >
            <Text style={styles.forgotText}>
              Forgot Password?
            </Text>
          </Pressable>

         
          <Pressable
            style={[
              styles.loginButton,
              loading && styles.disabledButton,
            ]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#4A302F" />
            ) : (
              <Text style={styles.buttonText}>
                Log in
              </Text>
            )}
          </Pressable>

        
          <Pressable
            onPress={() => router.push('/register')}
            disabled={loading}
          >
            <Text style={styles.signupText}>
              Create Account
            </Text>
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
    fontWeight: '700',
    color: '#4A302F',
  },

  signupText: {
    textAlign: 'center',
    fontSize: 8,
    color: '#7D6D6B',
    textDecorationLine: 'underline',
  },
});