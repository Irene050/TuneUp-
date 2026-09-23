import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { sendPasswordResetCode } from '@/services/firebase/authService';

export default function ForgotPasswordScreen() {
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
          <Text style={styles.backArrow}>‹</Text>
        </Pressable>

        {/* Title */}
        <Text style={styles.title}>
          Forgot Password?
        </Text>

        {/* Description */}
        <Text style={styles.description}>
          Enter your email address and we will send you
          a password reset email.
        </Text>

        {/* Email */}
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
          placeholder="Enter your email"
          placeholderTextColor="#A99C9A"
        />

        {/* Send Button */}
        <Pressable
          style={[
            styles.sendButton,
            loading && styles.disabledButton,
          ]}
          onPress={handleSendCode}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#4A302F" />
          ) : (
            <Text style={styles.buttonText}>
              Send
            </Text>
          )}
        </Pressable>

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
    fontWeight: '300',
    color: '#4A302F',
  },

  title: {
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '700',
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
    fontWeight: '700',
    color: '#4A302F',
  },
});