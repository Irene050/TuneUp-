import { Redirect, useLocalSearchParams } from 'expo-router';

import {
  ForgotPasswordScreen,
  LoginScreen,
  ResetPasswordScreen,
} from '@/screens/auth/LoginScreen';
import RegisterScreen from '@/screens/auth/RegisterScreen';

export default function AuthRoute() {
  const { auth } = useLocalSearchParams<{
    auth?: string | string[];
  }>();
  const route = Array.isArray(auth) ? auth[0] : auth;

  switch (route) {
    case 'login':
      return <LoginScreen />;
    case 'register':
      return <RegisterScreen />;
    case 'forgot-password':
      return <ForgotPasswordScreen />;
    case 'reset-password':
      return <ResetPasswordScreen />;
    default:
      return <Redirect href="/login" />;
  }
}