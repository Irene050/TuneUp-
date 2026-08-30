import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "./config";

const functions = getFunctions(app);

interface SendResetCodeResult {
  success: boolean;
}

interface VerifyResetCodeResult {
  success: boolean;
  resetToken: string;
}

interface ResetPasswordResult {
  success: boolean;
}

export async function sendResetCode(email: string): Promise<SendResetCodeResult> {
  const callable = httpsCallable<{ email: string }, SendResetCodeResult>(
    functions,
    "sendResetCode"
  );
  const result = await callable({ email });
  return result.data;
}

export async function verifyResetCode(
  email: string,
  code: string
): Promise<VerifyResetCodeResult> {
  const callable = httpsCallable<{ email: string; code: string }, VerifyResetCodeResult>(
    functions,
    "verifyResetCode"
  );
  const result = await callable({ email, code });
  return result.data;
}

export async function resetPasswordWithToken(
  email: string,
  resetToken: string,
  newPassword: string
): Promise<ResetPasswordResult> {
  const callable = httpsCallable<
    { email: string; resetToken: string; newPassword: string },
    ResetPasswordResult
  >(functions, "resetPasswordWithToken");
  const result = await callable({ email, resetToken, newPassword });
  return result.data;
}