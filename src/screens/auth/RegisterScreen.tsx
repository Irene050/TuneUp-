
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { registerUser } from '@/services/firebase/authService';

import { COLORS } from '@/constants/appConstants';
import { exerciseStyles } from '@/constants/exerciseStyles';
import {
  closeAlert,
  type AlertDetails,
} from '@/screens/auth/alertUtils';

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

  function handleDateChange(_event: any, date?: Date) {
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
      style={exerciseStyles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={exerciseStyles.scrollContent_Register}
        keyboardShouldPersistTaps="handled"
      >
        <View style={exerciseStyles.content_Register}>
          <Image
            source={require('@/assets/images/tabIcons/tuneup-logo.png')}
            style={exerciseStyles.logo_Register}
            resizeMode="contain"
          />

          <View style={exerciseStyles.form_Login_login}>
            <View style={exerciseStyles.row}>
              <View style={exerciseStyles.infoText}>
                <Text style={exerciseStyles.label_Register}>First Name</Text>

                <TextInput
                  style={exerciseStyles.input_Register}
                  value={firstName}
                  onChangeText={setFirstName}
                  autoCapitalize="words"
                  editable={!loading}
                />
              </View>

              <View style={exerciseStyles.infoText}>
                <Text style={exerciseStyles.label_Register}>Last Name</Text>

                <TextInput
                  style={exerciseStyles.input_Register}
                  value={lastName}
                  onChangeText={setLastName}
                  autoCapitalize="words"
                  editable={!loading}
                />
              </View>
            </View>

            <Text style={exerciseStyles.label_Register}>Email Address</Text>

            <TextInput
              style={exerciseStyles.input_Register}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!loading}
            />

            <View style={exerciseStyles.row}>
              <View style={exerciseStyles.infoText}>
                <Text style={exerciseStyles.label_Register}>Birthdate</Text>

                <Pressable
                  style={exerciseStyles.input_Register}
                  onPress={() => setShowDatePicker(true)}
                  disabled={loading}
                >
                  <Text
                    style={
                      birthdate
                        ? exerciseStyles.selectedText
                        : exerciseStyles.placeholderText
                    }
                  >
                    {birthdate || 'MM/DD/YYYY'}
                  </Text>
                </Pressable>
              </View>

              <View style={exerciseStyles.infoText}>
                <Text style={exerciseStyles.label_Register}>Gender</Text>

                <Pressable
                  style={exerciseStyles.input_Register}
                  onPress={() =>
                    setShowGenderDropdown((previous) => !previous)
                  }
                  disabled={loading}
                >
                  <View style={exerciseStyles.genderRow}>
                    <Text
                      style={
                        gender
                          ? exerciseStyles.selectedText
                          : exerciseStyles.placeholderText
                      }
                    >
                      {gender || 'Select Gender'}
                    </Text>

                    <Text style={exerciseStyles.dropdownArrow}>▾</Text>
                  </View>
                </Pressable>

                {showGenderDropdown && (
                  <View style={exerciseStyles.dropdown_Register}>
                    {['Male', 'Female', 'Non-binary'].map((option) => (
                      <Pressable
                        key={option}
                        style={exerciseStyles.dropdownOption}
                        onPress={() => {
                          setGender(option);
                          setShowGenderDropdown(false);
                        }}
                      >
                        <Text style={exerciseStyles.dropdownText_Register}>{option}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            </View>

            <Text style={exerciseStyles.label_Register}>Password</Text>

            <View style={exerciseStyles.passwordContainer_Register}>
              <TextInput
                style={exerciseStyles.passwordInput_Register}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!loading}
              />

              <Pressable
                style={exerciseStyles.eyeButton}
                onPress={() =>
                  setShowPassword((previous) => !previous)
                }
                disabled={loading}
                accessibilityRole="button"
                accessibilityLabel={
                  showPassword ? 'Hide password' : 'Show password'
                }
              >
                <Text style={exerciseStyles.eyeText_Register}>
                  {showPassword ? '◉' : '◌'}
                </Text>
              </Pressable>
            </View>

            <Text style={exerciseStyles.label_Register}>Confirm Password</Text>

            <View style={exerciseStyles.passwordContainer_Register}>
              <TextInput
                style={[
                  exerciseStyles.passwordInput_Register,
                  passwordsMismatch && exerciseStyles.passwordInputError,
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
                style={exerciseStyles.eyeButton}
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
                <Text style={exerciseStyles.eyeText_Register}>
                  {showConfirmPassword ? '◉' : '◌'}
                </Text>
              </Pressable>
            </View>

            {passwordsMismatch && (
              <Text style={exerciseStyles.passwordErrorText}>
                Passwords do not match.
              </Text>
            )}

            <Pressable
              style={[
                exerciseStyles.registerButton,
                loading && exerciseStyles.disabled,
              ]}
              onPress={handleRegister}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={COLORS.brown} />
              ) : (
                <Text style={exerciseStyles.buttonText_Register}>Create Account</Text>
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

      <TuneUpAlertModal
        alert={alert}
        onClose={() => closeAlert(alert, setAlert)}
      />
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
      <View style={exerciseStyles.modalOverlay}>
        <View style={exerciseStyles.card_Register_alert}>
          {type === 'info' ? (
            <Ionicons
              name={iconName}
              size={38}
              color={COLORS.brown}
              style={exerciseStyles.standaloneIcon}
            />
          ) : (
            <View
              style={[
                exerciseStyles.iconCircle_Register_alert,
                type === 'error' && exerciseStyles.selectedDropdownItem,
                type === 'success' && exerciseStyles.resultIconPassed,
              ]}
            >
              <Ionicons
                name={iconName}
                size={38}
                color={type === 'error' ? COLORS.error : COLORS.brown}
              />
            </View>
          )}

          <Text style={exerciseStyles.title_Login_alert}>{title}</Text>

          <Text style={exerciseStyles.message_Register_alert}>{message}</Text>

          <Pressable
            style={({ pressed }) => [
              exerciseStyles.button_Register_alert,
              pressed && exerciseStyles.buttonPressed,
            ]}
            onPress={onClose}
          >
            <Text style={exerciseStyles.buttonText_Register_alert}>{buttonLabel}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}