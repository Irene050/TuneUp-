
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { registerUser } from '@/services/firebase/authService';

import { COLORS } from '@/constants/appConstants';

type AlertType = 'success' | 'error' | 'info';

type AlertDetails = {
  title: string;
  message: string;
  type: AlertType;
  buttonLabel?: string;
  onConfirm?: () => void;
};

export default function RegisterScreen() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [birthdate, setBirthdate] = useState('');
  const [gender, setGender] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showGenderDropdown, setShowGenderDropdown] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [alert, setAlert] = useState<AlertDetails | null>(null);

  const passwordsMismatch =
    confirmPassword.length > 0 && password !== confirmPassword;

  function closeAlert() {
    const onConfirm = alert?.onConfirm;

    setAlert(null);
    onConfirm?.();
  }

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
      !password ||
      !confirmPassword
    ) {
      setAlert({
        title: 'Missing Information',
        message: 'Please complete all fields.',
        type: 'info',
      });
      return;
    }

    if (password !== confirmPassword) {
      setAlert({
        title: 'Passwords Do Not Match',
        message:
          'Please make sure both password fields contain the same password.',
        type: 'error',
      });
      return;
    }

    try {
      setLoading(true);

      const fullName = `${firstName.trim()} ${lastName.trim()}`;

      await registerUser(fullName, email.trim(), password, {
        birthdate: birthdate.trim(),
        gender: gender.trim(),
      });

      setAlert({
        title: 'Account Created!',
        message: 'Your account has been successfully created.',
        type: 'success',
        buttonLabel: 'Continue',
        onConfirm: () => router.replace('/dashboard'),
      });
    } catch (error: any) {
      let message = 'Unable to create your account.';

      switch (error?.code) {
        case 'auth/email-already-in-use':
          message = 'An account already exists with this email.';
          break;

        case 'auth/invalid-email':
          message = 'Please enter a valid email address.';
          break;

        case 'auth/weak-password':
          message = 'Password must be at least 6 characters.';
          break;

        case 'auth/network-request-failed':
          message = 'Network error. Please check your connection.';
          break;

        default:
          if (error instanceof Error) {
            message = error.message;
          }
      }

      setAlert({
        title: 'Registration Failed',
        message,
        type: 'error',
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.content}>
          <Image
            source={require('@/assets/images/tabIcons/tuneup-logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />

          <View style={styles.form}>
            <View style={styles.row}>
              <View style={styles.halfInput}>
                <Text style={styles.label}>First Name</Text>

                <TextInput
                  style={styles.input}
                  value={firstName}
                  onChangeText={setFirstName}
                  autoCapitalize="words"
                  editable={!loading}
                />
              </View>

              <View style={styles.halfInput}>
                <Text style={styles.label}>Last Name</Text>

                <TextInput
                  style={styles.input}
                  value={lastName}
                  onChangeText={setLastName}
                  autoCapitalize="words"
                  editable={!loading}
                />
              </View>
            </View>

            <Text style={styles.label}>Email Address</Text>

            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!loading}
            />

            <View style={styles.row}>
              <View style={styles.halfInput}>
                <Text style={styles.label}>Birthdate</Text>

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

              <View style={styles.halfInput}>
                <Text style={styles.label}>Gender</Text>

                <Pressable
                  style={styles.input}
                  onPress={() =>
                    setShowGenderDropdown((previous) => !previous)
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

                    <Text style={styles.dropdownArrow}>▾</Text>
                  </View>
                </Pressable>

                {showGenderDropdown && (
                  <View style={styles.dropdown}>
                    {['Male', 'Female', 'Non-binary'].map((option) => (
                      <Pressable
                        key={option}
                        style={styles.dropdownOption}
                        onPress={() => {
                          setGender(option);
                          setShowGenderDropdown(false);
                        }}
                      >
                        <Text style={styles.dropdownText}>{option}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            </View>

            <Text style={styles.label}>Password</Text>

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

              <Pressable
                style={styles.eyeButton}
                onPress={() =>
                  setShowPassword((previous) => !previous)
                }
                disabled={loading}
                accessibilityRole="button"
                accessibilityLabel={
                  showPassword ? 'Hide password' : 'Show password'
                }
              >
                <Text style={styles.eyeText}>
                  {showPassword ? '◉' : '◌'}
                </Text>
              </Pressable>
            </View>

            <Text style={styles.label}>Confirm Password</Text>

            <View style={styles.passwordContainer}>
              <TextInput
                style={[
                  styles.passwordInput,
                  passwordsMismatch && styles.passwordInputError,
                ]}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showConfirmPassword}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!loading}
                returnKeyType="done"
                onSubmitEditing={handleRegister}
              />

              <Pressable
                style={styles.eyeButton}
                onPress={() =>
                  setShowConfirmPassword((previous) => !previous)
                }
                disabled={loading}
                accessibilityRole="button"
                accessibilityLabel={
                  showConfirmPassword
                    ? 'Hide confirm password'
                    : 'Show confirm password'
                }
              >
                <Text style={styles.eyeText}>
                  {showConfirmPassword ? '◉' : '◌'}
                </Text>
              </Pressable>
            </View>

            {passwordsMismatch && (
              <Text style={styles.passwordErrorText}>
                Passwords do not match.
              </Text>
            )}

            <Pressable
              style={[
                styles.registerButton,
                loading && styles.disabledButton,
              ]}
              onPress={handleRegister}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={COLORS.brown} />
              ) : (
                <Text style={styles.buttonText}>Create Account</Text>
              )}
            </Pressable>
          </View>
        </View>
      </ScrollView>

      {showDatePicker && (
        <DateTimePicker
          value={selectedDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'calendar'}
          maximumDate={new Date()}
          onChange={handleDateChange}
        />
      )}

      <TuneUpAlertModal alert={alert} onClose={closeAlert} />
    </KeyboardAvoidingView>
  );
}

function TuneUpAlertModal({
  alert,
  onClose,
}: {
  alert: AlertDetails | null;
  onClose: () => void;
}) {
  if (!alert) return null;

  const { title, message, type, buttonLabel = 'OK' } = alert;

  const iconName =
    type === 'success'
      ? 'checkmark-circle-outline'
      : type === 'error'
        ? 'alert-circle-outline'
        : 'information-circle-outline';

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={alertStyles.overlay}>
        <View style={alertStyles.card}>
          {type === 'info' ? (
            <Ionicons
              name={iconName}
              size={38}
              color={COLORS.brown}
              style={alertStyles.standaloneIcon}
            />
          ) : (
            <View
              style={[
                alertStyles.iconCircle,
                type === 'error' && alertStyles.errorIconCircle,
                type === 'success' && alertStyles.successIconCircle,
              ]}
            >
              <Ionicons
                name={iconName}
                size={38}
                color={type === 'error' ? COLORS.error : COLORS.brown}
              />
            </View>
          )}

          <Text style={alertStyles.title}>{title}</Text>

          <Text style={alertStyles.message}>{message}</Text>

          <Pressable
            style={({ pressed }) => [
              alertStyles.button,
              pressed && alertStyles.buttonPressed,
            ]}
            onPress={onClose}
          >
            <Text style={alertStyles.buttonText}>{buttonLabel}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    marginTop: 50,
    flex: 1,
    paddingHorizontal: 26,
  },
  header: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    marginHorizontal: -26,
    paddingHorizontal: 26,
  },
  title: {
    fontSize: 14,
    color: COLORS.brown,
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
    color: COLORS.dark,
    marginBottom: 6,
  },
  input: {
    height: 42,
    backgroundColor: COLORS.background,
    borderRadius: 3,
    paddingHorizontal: 12,
    fontSize: 13,
    color: COLORS.text,
    marginBottom: 14,
    justifyContent: 'center',
  },
  selectedText: {
    fontSize: 13,
    color: COLORS.text,
  },
  placeholderText: {
    fontSize: 13,
    color: COLORS.gray,
  },
  genderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flex: 1,
  },
  dropdownArrow: {
    fontSize: 10,
    color: COLORS.text,
  },
  dropdown: {
    position: 'absolute',
    top: 48,
    left: 0,
    right: 0,
    backgroundColor: COLORS.white,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
    zIndex: 100,
    elevation: 5,
  },
  dropdownOption: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.white,
  },
  dropdownText: {
    fontSize: 12,
    color: COLORS.text,
  },
  passwordContainer: {
    position: 'relative',
    width: '100%',
  },
  passwordInput: {
    height: 42,
    backgroundColor: COLORS.background,
    borderRadius: 3,
    paddingHorizontal: 12,
    paddingRight: 42,
    fontSize: 13,
    color: COLORS.text,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  passwordInputError: {
    borderColor: COLORS.error,
  },
  passwordErrorText: {
    color: COLORS.error,
    fontSize: 11,
    marginTop: -8,
    marginBottom: 10,
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
    color: COLORS.muted,
  },
  registerButton: {
    width: 105,
    height: 34,
    borderRadius: 18,
    backgroundColor: COLORS.pink,
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
    fontFamily: 'FredokaBold',
    color: COLORS.dark,
  },
});

const alertStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: COLORS.transparentbrown,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: COLORS.white,
    borderRadius: 24,
    paddingHorizontal: 26,
    paddingTop: 30,
    paddingBottom: 24,
    alignItems: 'center',
    elevation: 10,
    shadowColor: COLORS.brown,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  errorIconCircle: {
    backgroundColor: COLORS.background,
  },
  successIconCircle: {
    backgroundColor: COLORS.pink,
  },
  standaloneIcon: {
    marginBottom: 18,
  },
  title: {
    fontFamily: 'FredokaBold',
    fontSize: 22,
    color: COLORS.brown,
    textAlign: 'center',
    marginBottom: 10,
  },
  message: {
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.muted,
    textAlign: 'center',
    marginBottom: 24,
  },
  button: {
    width: '100%',
    minHeight: 46,
    borderRadius: 23,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  buttonPressed: {
    opacity: 0.75,
  },
  buttonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 16,
    color: COLORS.brown,
  },
});