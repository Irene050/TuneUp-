import DateTimePicker from '@react-native-community/datetimepicker';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { registerUser } from '@/services/firebase/authService';

export default function RegisterScreen() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [birthdate, setBirthdate] = useState('');
  const [gender, setGender] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // Birthdate
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());

  // Gender dropdown
  const [showGenderDropdown, setShowGenderDropdown] =
    useState(false);

  // Password eye
  const [showPassword, setShowPassword] = useState(false);

  function handleDateChange(event: any, date?: Date) {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
    }

    if (date) {
      setSelectedDate(date);

      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const year = date.getFullYear();

      setBirthdate(`${month}/${day}/${year}`);
    }
  }

  async function handleRegister() {
    if (
      !firstName.trim() ||
      !lastName.trim() ||
      !email.trim() ||
      !birthdate.trim() ||
      !gender.trim() ||
      !password
    ) {
      Alert.alert(
        'Missing information',
        'Please complete all fields.',
      );
      return;
    }

    try {
      setLoading(true);

      const fullName = `${firstName.trim()} ${lastName.trim()}`;

      await registerUser(fullName, email, password, {
        birthdate: birthdate.trim(),
        gender: gender.trim(),
      });

      Alert.alert(
        'Account Created',
        'Your account has been successfully created.',
        [
          {
            text: 'Continue',
            onPress: () => router.replace('/dashboard'),
          },
        ],
      );
    } catch (error: any) {
      let message = 'Unable to create your account.';

      switch (error?.code) {
        case 'auth/email-already-in-use':
          message =
            'An account already exists with this email.';
          break;

        case 'auth/invalid-email':
          message =
            'Please enter a valid email address.';
          break;

        case 'auth/weak-password':
          message =
            'Password must be at least 6 characters.';
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

      Alert.alert('Registration failed', message);
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
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.content}>

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Register</Text>
            <View style={styles.headerSpacer} />
          </View>

          {/* TuneUp Logo */}
          <Image
            source={require('@/assets/images/tuneup-logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />

          <View style={styles.form}>

            {/* First Name / Last Name */}
            <View style={styles.row}>
              <View style={styles.halfInput}>
                <Text style={styles.label}>
                  First Name
                </Text>

                <TextInput
                  style={styles.input}
                  value={firstName}
                  onChangeText={setFirstName}
                  autoCapitalize="words"
                  editable={!loading}
                />
              </View>

              <View style={styles.halfInput}>
                <Text style={styles.label}>
                  Last Name
                </Text>

                <TextInput
                  style={styles.input}
                  value={lastName}
                  onChangeText={setLastName}
                  autoCapitalize="words"
                  editable={!loading}
                />
              </View>
            </View>

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
            />

            {/* Birthdate / Gender */}
            <View style={styles.row}>

              {/* Birthdate */}
              <View style={styles.halfInput}>
                <Text style={styles.label}>
                  Birthdate
                </Text>

                <Pressable
                  style={styles.input}
                  onPress={() => setShowDatePicker(true)}
                  disabled={loading}
                >
                  <Text
                    style={
                      birthdate
                        ? styles.selectedText
                        : styles.placeholderText
                    }
                  >
                    {birthdate || 'MM/DD/YYYY'}
                  </Text>
                </Pressable>
              </View>

              {/* Gender */}
              <View style={styles.halfInput}>
                <Text style={styles.label}>
                  Gender
                </Text>

                <Pressable
                  style={styles.input}
                  onPress={() =>
                    setShowGenderDropdown(
                      (previous) => !previous,
                    )
                  }
                  disabled={loading}
                >
                  <View style={styles.genderRow}>
                    <Text
                      style={
                        gender
                          ? styles.selectedText
                          : styles.placeholderText
                      }
                    >
                      {gender || 'Select Gender'}
                    </Text>

                    <Text style={styles.dropdownArrow}>
                      ▾
                    </Text>
                  </View>
                </Pressable>

                {showGenderDropdown && (
                  <View style={styles.dropdown}>

                    <Pressable
                      style={styles.dropdownOption}
                      onPress={() => {
                        setGender('Male');
                        setShowGenderDropdown(false);
                      }}
                    >
                      <Text style={styles.dropdownText}>
                        Male
                      </Text>
                    </Pressable>

                    <Pressable
                      style={styles.dropdownOption}
                      onPress={() => {
                        setGender('Female');
                        setShowGenderDropdown(false);
                      }}
                    >
                      <Text style={styles.dropdownText}>
                        Female
                      </Text>
                    </Pressable>

                    <Pressable
                      style={styles.dropdownOption}
                      onPress={() => {
                        setGender('Non-binary');
                        setShowGenderDropdown(false);
                      }}
                    >
                      <Text style={styles.dropdownText}>
                        Non-binary
                      </Text>
                    </Pressable>

                  </View>
                )}
              </View>
            </View>

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
                editable={!loading}
              />

              <Pressable
                style={styles.eyeButton}
                onPress={() =>
                  setShowPassword(
                    (previous) => !previous,
                  )
                }
                disabled={loading}
              >
                <Text style={styles.eyeText}>
                  {showPassword ? '◉' : '◌'}
                </Text>
              </Pressable>
            </View>

            {/* Create Account */}
            <Pressable
              style={[
                styles.registerButton,
                loading && styles.disabledButton,
              ]}
              onPress={handleRegister}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#4A302F" />
              ) : (
                <Text style={styles.buttonText}>
                  Create Account
                </Text>
              )}
            </Pressable>

          </View>
        </View>
      </ScrollView>

      {/* Birthdate Calendar */}
      {showDatePicker && (
        <DateTimePicker
          value={selectedDate}
          mode="date"
          display={
            Platform.OS === 'ios'
              ? 'spinner'
              : 'calendar'
          }
          maximumDate={new Date()}
          onChange={handleDateChange}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },

  scrollContent: {
    flexGrow: 1,
  },

  content: {
    flex: 1,
    paddingHorizontal: 26,
  },

  header: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
    marginHorizontal: -26,
    paddingHorizontal: 26,
  },

  title: {
    fontSize: 14,
    color: '#3F2B2A',
  },

  headerSpacer: {
    width: 20,
  },

  logo: {
    width: 75,
    height: 75,
    alignSelf: 'center',
    marginTop: 28,
    marginBottom: 35,
  },

  form: {
    width: '100%',
  },

  row: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },

  halfInput: {
    flex: 1,
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
    justifyContent: 'center',
  },

  selectedText: {
    fontSize: 13,
    color: '#3F2B2A',
  },

  placeholderText: {
    fontSize: 13,
    color: '#A9A0A0',
  },

  /* Gender Dropdown */
  genderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flex: 1,
  },

  dropdownArrow: {
    fontSize: 10,
    color: '#4A302F',
  },

  dropdown: {
    position: 'absolute',
    top: 48,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    zIndex: 100,
    elevation: 5,
  },

  dropdownOption: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },

  dropdownText: {
    fontSize: 12,
    color: '#3F2B2A',
  },

  /* Password */
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

  registerButton: {
    width: 105,
    height: 34,
    borderRadius: 18,
    backgroundColor: '#F8CBD4',
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },

  disabledButton: {
    opacity: 0.6,
  },

  buttonText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#4A302F',
  },
});