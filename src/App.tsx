import React, { useState, useEffect, useRef } from "react";
import { 
  Mic, 
  MicOff, 
  Sparkles, 
  CheckCircle,
  Database,
  ArrowRight,
  TrendingDown,
  Coins,
  X,
  Volume2,
  Lock,
  LogOut,
  RefreshCw,
  User as UserIcon,
  CloudLightning,
  ExternalLink,
  Info,
  Upload,
  Download,
  Cloud
} from "lucide-react";
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut, User } from "firebase/auth";
import { doc, getDocFromServer } from "firebase/firestore";
import { Transaction, UserProfile, Goal, DriveData } from "./types";
import { auth, db } from "./firebase";
import firebaseConfig from "../firebase-applet-config.json";
import {
  findBackupFile,
  downloadBackupFile,
  createBackupFile,
  updateBackupFile
} from "./lib/googleDriveService";
import AIBuddyAvatar from "./components/AIBuddyAvatar";
import BudgetGoalWidgets from "./components/BudgetGoalWidgets";
import TransactionList from "./components/TransactionList";

// Sample voice lines for instant testing
const SIMULATED_VOICES = [
  "Ăn bát phở bò Kobe hết 150 cành",
  "Mới chốt cái váy hoa 2 củ rưỡi xịn xò",
  "Hôm nay thèm trà sữa trà đào hết 60k sương sương",
  "Được công ty ting ting lương tháng này 15 củ nà",
  "Nộp tiền trọ với tiền điện hết 3 củ mốt",
  "Đổ bình xăng grab xe hết 8 chục",
  "Mua vé xem phim rạp CGV hết 1 lít 2",
  "Nhặt được tiền rơi ngoài ngõ được 5 xị hihi"
];

const INITIAL_PROFILE: UserProfile = {
  total_balance: 5000000,
  currency: "VND",
  monthly_budget: 8000000
};

export default function App() {
  // ---------------------------------------------------------------------------
  // Core React & Firebase States
  // ---------------------------------------------------------------------------
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile>(INITIAL_PROFILE);
  const [goals, setGoals] = useState<Goal[]>([]);

  const [inputText, setInputText] = useState("");
  const [aiReply, setAiReply] = useState("");
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Google Drive & Local Sync States
  const [googleAccessToken, setGoogleAccessToken] = useState<string | null>(null);
  const [lastDriveSync, setLastDriveSync] = useState<string | null>(() => localStorage.getItem("last_drive_sync"));
  const [driveFileId, setDriveFileId] = useState<string | null>(() => localStorage.getItem("drive_file_id"));
  const [autoSaveEnabled, setAutoSaveEnabled] = useState<boolean>(true);

  // UI States
  const [showSimPresets, setShowSimPresets] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [notification, setNotification] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);
  const [popupError, setPopupError] = useState(false);
  const [domainError, setDomainError] = useState(false);

  // Manual fast entry states with target support for money received / revenue
  const [inputTab, setInputTab] = useState<"ai" | "manual">("ai");
  const [manualAmount, setManualAmount] = useState<string>("");
  const [manualCategory, setManualCategory] = useState<string>("Ăn uống");
  const [manualNote, setManualNote] = useState<string>("");
  const [manualType, setManualType] = useState<"expense" | "income">("income");

  const [hasSetInitialBalance, setHasSetInitialBalance] = useState<boolean>(() => {
    return localStorage.getItem("has_set_initial_balance") === "true";
  });
  const [onboardingBalance, setOnboardingBalance] = useState<string>("5.000.000");
  const [onboardingBudget, setOnboardingBudget] = useState<string>("8.000.000");

  const isInIframe = typeof window !== "undefined" && window.self !== window.top;

  const recognitionRef = useRef<any>(null);

  const showToast = (text: string, type: "success" | "error" | "info" = "success") => {
    setNotification({ text, type });
    setTimeout(() => {
      setNotification((prev) => (prev?.text === text ? null : prev));
    }, 4500);
  };

  // 1. Mandatory connection test as per SKILL guidelines
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, "test", "connection"));
      } catch (error) {
        if (error instanceof Error && error.message.includes("the client is offline")) {
          console.error("Please check your Firebase configuration.");
        }
      }
    }
    testConnection();
  }, []);

  // 2. Track Firebase Auth state change and load local storage on mount as our core database
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
      if (!currentUser) {
        setGoogleAccessToken(null);
      }
    });

    // Always load local device storage as single source of truth
    const savedProfile = localStorage.getItem("expense_tracker_profile");
    const savedTx = localStorage.getItem("expense_tracker_tx");
    const savedGoals = localStorage.getItem("expense_tracker_goals");

    if (savedProfile) {
      setUserProfile(JSON.parse(savedProfile));
      setHasSetInitialBalance(true);
      localStorage.setItem("has_set_initial_balance", "true");
    } else {
      setUserProfile(INITIAL_PROFILE);
      if (localStorage.getItem("has_set_initial_balance") !== "true") {
        setHasSetInitialBalance(false);
      }
    }

    if (savedTx) {
      setTransactions(JSON.parse(savedTx));
    } else {
      setTransactions([]);
    }

    if (savedGoals) {
      setGoals(JSON.parse(savedGoals));
    } else {
      setGoals([]);
    }

    return () => unsubscribe();
  }, []);

  // Sync state helper to save locally + silently backup to Google Drive
  const syncDataInLocalStorageAndDrive = async (
    newProfile: UserProfile,
    newTx: Transaction[],
    newGoals: Goal[]
  ) => {
    setUserProfile(newProfile);
    setTransactions(newTx);
    setGoals(newGoals);

    saveStateLocally(newProfile, newTx, newGoals);

    if (autoSaveEnabled && googleAccessToken) {
      try {
        let fileId = driveFileId;
        if (!fileId) {
          fileId = await findBackupFile(googleAccessToken);
          if (fileId) {
            setDriveFileId(fileId);
            localStorage.setItem("drive_file_id", fileId);
          }
        }

        const dataPayload: DriveData = {
          user_profile: newProfile,
          transactions: newTx,
          goals: newGoals
        };

        if (fileId) {
          await updateBackupFile(googleAccessToken, fileId, dataPayload);
        } else {
          const newId = await createBackupFile(googleAccessToken, dataPayload);
          if (newId) {
            setDriveFileId(newId);
            localStorage.setItem("drive_file_id", newId);
          }
        }

        const timeStr = new Date().toLocaleString("vi-VN");
        setLastDriveSync(timeStr);
        localStorage.setItem("last_drive_sync", timeStr);
      } catch (err) {
        console.error("Background auto-save failed:", err);
      }
    }
  };

  // Active sync control trigger for Google Drive (Force upload or Force download)
  const syncWithGoogleDrive = async (token: string, forceTarget?: "upload" | "download") => {
    setIsSyncing(true);
    try {
      let fileId = driveFileId;
      if (!fileId) {
        fileId = await findBackupFile(token);
        if (fileId) {
          setDriveFileId(fileId);
          localStorage.setItem("drive_file_id", fileId);
        }
      }

      const activeLocalData: DriveData = {
        user_profile: userProfile,
        transactions: transactions,
        goals: goals
      };

      if (!fileId) {
        if (forceTarget === "download") {
          showToast("Không tìm thấy tệp sao lưu nào trên Google Drive để đồng bộ ngược!", "error");
          return;
        }

        // Create new backup file
        const newId = await createBackupFile(token, activeLocalData);
        if (newId) {
          setDriveFileId(newId);
          localStorage.setItem("drive_file_id", newId);
          const timeStr = new Date().toLocaleString("vi-VN");
          setLastDriveSync(timeStr);
          localStorage.setItem("last_drive_sync", timeStr);
          showToast("Đã khởi tạo và Sao lưu dữ liệu hiện tại lên Google Drive thành công!", "success");
        } else {
          showToast("Không thể tạo tệp đồng bộ Google Drive.", "error");
        }
      } else {
        if (forceTarget === "upload") {
          // Sync UP
          const success = await updateBackupFile(token, fileId, activeLocalData);
          if (success) {
            const timeStr = new Date().toLocaleString("vi-VN");
            setLastDriveSync(timeStr);
            localStorage.setItem("last_drive_sync", timeStr);
            showToast("Bản sao lưu Google Drive đã được cập nhật thành công!", "success");
          } else {
            showToast("Đồng bộ lên Google Drive thất bại.", "error");
          }
        } else if (forceTarget === "download") {
          // Sync DOWN
          const ok = window.confirm(
            "Xác nhận khôi phục? Thao tác này sẽ thay đổi TOÀN BỘ số dư, giao dịch, mục tiêu hiện có bằng dữ liệu trong Google Drive."
          );
          if (!ok) return;

          const onlineData = await downloadBackupFile(token, fileId);
          if (onlineData) {
            const profileToUse = onlineData.user_profile || userProfile;
            const txToUse = onlineData.transactions || transactions;
            const goalsToUse = onlineData.goals || goals;

            setUserProfile(profileToUse);
            setTransactions(txToUse);
            setGoals(goalsToUse);
            setHasSetInitialBalance(true);

            saveStateLocally(profileToUse, txToUse, goalsToUse);

            const timeStr = new Date().toLocaleString("vi-VN");
            setLastDriveSync(timeStr);
            localStorage.setItem("last_drive_sync", timeStr);
            showToast("Đã khôi phục toàn bộ dữ liệu từ Google Drive về máy thành công!", "success");
          } else {
            showToast("Không thể tải xuống dữ liệu từ Google Drive.", "error");
          }
        } else {
          // Auto load on login if local is clear
          const localIsEmpty = transactions.length === 0 && goals.length === 0;
          if (localIsEmpty) {
            const onlineData = await downloadBackupFile(token, fileId);
            if (onlineData) {
              const profileToUse = onlineData.user_profile || userProfile;
              const txToUse = onlineData.transactions || transactions;
              const goalsToUse = onlineData.goals || goals;

              setUserProfile(profileToUse);
              setTransactions(txToUse);
              setGoals(goalsToUse);
              setHasSetInitialBalance(true);

              saveStateLocally(profileToUse, txToUse, goalsToUse);

              const timeStr = new Date().toLocaleString("vi-VN");
              setLastDriveSync(timeStr);
              localStorage.setItem("last_drive_sync", timeStr);
              showToast("Đã tải tự động dữ liệu sao lưu cũ từ Google Drive!", "success");
            }
          } else {
            showToast("Kết nối với Google Drive của bạn đã sẵn sàng!", "info");
          }
        }
      }
    } catch (err: any) {
      showToast(`Đồng bộ thất bại: ${err.message || err}`, "error");
    } finally {
      setIsSyncing(false);
    }
  };

  // Local-storage file persistence (used as fallback or sync cache)
  const saveStateLocally = (newProfile: UserProfile, newTx: Transaction[], newGoals: Goal[]) => {
    localStorage.setItem("expense_tracker_profile", JSON.stringify(newProfile));
    localStorage.setItem("expense_tracker_tx", JSON.stringify(newTx));
    localStorage.setItem("expense_tracker_goals", JSON.stringify(newGoals));
    localStorage.setItem("has_set_initial_balance", "true");
  };

  // ---------------------------------------------------------------------------
  // Web Speech API Voice Handlers
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      setSpeechSupported(true);
      const rec = new SpeechRecognition();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = "vi-VN";

      rec.onstart = () => {
        setIsRecording(true);
        setAiError(null);
      };

      rec.onresult = (event: any) => {
        const resultText = event.results[0][0].transcript;
        setInputText(resultText);
        showToast("Đã ghi nhận giọng nói tiếng Việt của bạn!", "success");
      };

      rec.onerror = (e: any) => {
        console.error("Speech Recognition Error:", e);
        showToast("Mic bị lỗi hoặc quyền ghi âm bị chặn.", "error");
        setIsRecording(false);
      };

      rec.onend = () => {
        setIsRecording(false);
      };

      recognitionRef.current = rec;
    }
  }, []);

  const toggleRecording = () => {
    if (!speechSupported) {
      showToast("Trình duyệt không hỗ trợ Web Speech API. Hãy gõ trực tiếp hoặc sử dụng presets!", "info");
      return;
    }

    if (isRecording) {
      recognitionRef.current?.stop();
    } else {
      try {
        recognitionRef.current?.start();
      } catch (err) {
        console.error(err);
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Google Sign-In & Sign-Out Functions
  // ---------------------------------------------------------------------------
  const handleGoogleSignIn = async () => {
    const provider = new GoogleAuthProvider();
    provider.addScope("https://www.googleapis.com/auth/drive.file");
    try {
      setIsSyncing(true);
      setPopupError(false); // Reset any prior popup block state
      setDomainError(false); // Reset prior domain authorization error
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      
      if (credential?.accessToken) {
        setGoogleAccessToken(credential.accessToken);
        showToast("Đăng nhập và tích hợp Google Drive thành công!", "success");
        await syncWithGoogleDrive(credential.accessToken);
      } else {
        showToast("Đăng nhập thành công nhưng thiếu quyền Google Drive.", "info");
      }
    } catch (err: any) {
      console.error("Sign-In popup failed:", err);
      const isPopupBlocked = 
        err.code === "auth/popup-blocked" || 
        err.message?.includes("popup-blocked") || 
        err.message?.includes("popup") ||
        err.code?.includes("popup");
      
      const isUnauthorizedDomain =
        err.code === "auth/unauthorized-domain" ||
        err.message?.includes("unauthorized-domain") ||
        err.message?.includes("unauthorized");

      if (isUnauthorizedDomain) {
        setDomainError(true);
        showToast("Tên miền chưa được xác thực trong Firebase!", "error");
      } else if (isPopupBlocked) {
        setPopupError(true);
        showToast("Cửa sổ đăng nhập bị chặn bởi trình duyệt!", "error");
      } else {
        showToast(`Đăng nhập thất bại: ${err.message}`, "error");
      }
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSignOut = async () => {
    const ok = window.confirm("Xác nhận đăng xuất tài khoản? Mọi dữ liệu hiện tại vẫn tiếp tục được lưu trữ ngoại tuyến an toàn.");
    if (!ok) return;

    try {
      await signOut(auth);
      setGoogleAccessToken(null);
      showToast("Đã đăng xuất. Bạn đã chuyển về chế độ Ngoại tuyến độc lập.", "info");
    } catch (err: any) {
      showToast("Đăng xuất thất bại.", "error");
    }
  };

  // ---------------------------------------------------------------------------
  // Gemini AI parser API Request Proxier
  // ---------------------------------------------------------------------------
  const handleParseTransaction = async (textToParse: string) => {
    if (!textToParse.trim()) return;

    setIsAiLoading(true);
    setAiError(null);

    try {
      const response = await fetch("/api/expense/parse", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text: textToParse,
          totalBalance: calculatedBalance,
          currency: "VND"
        })
      });

      let responseText = "";
      try {
        responseText = await response.text();
      } catch (readErr) {
        throw new Error("Không thể đọc phản hồi từ máy chủ.");
      }

      if (!response.ok) {
        let errMsg = "Gặp sự cố khi kết nối Gemini AI.";
        try {
          const errData = JSON.parse(responseText);
          errMsg = errData.error || errMsg;
        } catch {
          if (
            responseText.includes("<html") || 
            responseText.includes("<!DOCTYPE") || 
            responseText.includes("The page") ||
            responseText.includes("Cannot POST")
          ) {
            errMsg = "Hệ thống AI đang khởi động lại hoặc gặp sự cố đường truyền đám mây. Vui lòng thử lại sau vài giây.";
          } else {
            errMsg = responseText || errMsg;
          }
        }
        throw new Error(errMsg);
      }

      let parsedResult;
      try {
        parsedResult = JSON.parse(responseText);
      } catch {
        throw new Error("Dữ liệu phản hồi từ AI không đúng định dạng JSON chuẩn.");
      }

      const amount = Number(parsedResult.amount) || 0;
      const category = parsedResult.category || "Khác";
      const note = parsedResult.note || textToParse;
      const type = parsedResult.type === "income" ? "income" : "expense";
      const reply = parsedResult.reply || "Đã ghi nhận giao dịch thành công!";

      setAiReply(reply);

      await _insertTransaction({ amount, category, note, type });
      setInputText("");
      showToast("Gemini đã phân loại và lưu thành công!", "success");
    } catch (err: any) {
      console.error(err);
      if (err.message?.includes("GEMINI_API_KEY")) {
        setAiError("Chưa bật hoặc thiếu API Key của Gemini. Hãy kích hoạt GEMINI_API_KEY ở cột Settings.");
      } else {
        setAiError(err.message || "Không thể kết nối đến bộ não Gemini AI.");
      }
    } finally {
      setIsAiLoading(false);
    }
  };

  const _insertTransaction = async (payload: { amount: number; category: string; note: string; type: "expense" | "income" }) => {
    const newTx: Transaction = {
      id: Date.now().toString(),
      date: new Date().toISOString(),
      amount: payload.amount,
      category: payload.category,
      note: payload.note,
      type: payload.type
    };

    const updatedTx = [newTx, ...transactions];
    await syncDataInLocalStorageAndDrive(userProfile, updatedTx, goals);
  };

  const handleAddManualTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountVal = Number(manualAmount.replace(/[^0-9]/g, "")) || Number(manualAmount) || 0;
    if (amountVal <= 0) {
      showToast("Vui lòng nhập số tiền hợp lý!", "error");
      return;
    }
    if (!manualNote.trim()) {
      showToast("Vui lòng nhập nội dung ghi chú nhé!", "error");
      return;
    }

    await _insertTransaction({
      amount: amountVal,
      category: manualCategory,
      note: manualNote.trim(),
      type: manualType
    });

    setManualAmount("");
    setManualNote("");
    showToast(
      manualType === "income" 
        ? `Đã nhận được +${amountVal.toLocaleString("vi-VN")} đ! Chúc mừng ní nhé!` 
        : `Đã chi tiêu -${amountVal.toLocaleString("vi-VN")} đ thành công.`, 
      "success"
    );

    if (manualType === "income") {
      setAiReply(`💰 Đã cộng thêm ${amountVal.toLocaleString("vi-VN")} VND vào tài khoản! Tiền vô túi thơm ngát ní êu uii! Chăm chỉ kiếm tiền xịn sò quá xá hà!`);
    } else {
      setAiReply(`💸 Đã thêm khoản chi ${amountVal.toLocaleString("vi-VN")} VND cho mục "${manualCategory}". Ghi sổ đầy đủ dị là tốt dợp, cố lên cự ví nha!`);
    }
  };

  const handleOnboardingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const balanceVal = Number(onboardingBalance.replace(/[^0-9]/g, "")) || 0;
    const budgetVal = Number(onboardingBudget.replace(/[^0-9]/g, "")) || 8000000;

    const newProfile: UserProfile = {
      total_balance: balanceVal,
      currency: "VND",
      monthly_budget: budgetVal
    };

    localStorage.setItem("has_set_initial_balance", "true");
    setHasSetInitialBalance(true);
    await syncDataInLocalStorageAndDrive(newProfile, transactions, goals);
    showToast(`Đã thiết lập số dư bắt đầu là ${balanceVal.toLocaleString("vi-VN")} VND thành công!`, "success");
    setAiReply(`🎉 Chào mừng ní đã đến với Bét-Phờ-Ren Tài Chính! Tui đã cài đặt số dư hiện tại của ní là ${balanceVal.toLocaleString("vi-VN")} VND rùi nhá. Ví sẵn sàng, lên đường săn deal hời thui nào ní ơi! 🚀`);
  };

  // ---------------------------------------------------------------------------
  // Action Event Dispatchers
  // ---------------------------------------------------------------------------
  const handleDeleteTransaction = async (id: string) => {
    const updatedTx = transactions.filter((tx) => tx.id !== id);
    await syncDataInLocalStorageAndDrive(userProfile, updatedTx, goals);
    showToast("Đã xóa giao dịch thành công.", "success");
  };

  const handleUpdateBudget = async (newBudget: number) => {
    const updatedProfile = { ...userProfile, monthly_budget: newBudget };
    await syncDataInLocalStorageAndDrive(updatedProfile, transactions, goals);
    showToast("Cập nhật hạn mức chi tiêu thành công!", "success");
  };

  const handleAddGoal = async (name: string, target: number) => {
    const newGoal: Goal = {
      id: Date.now().toString(),
      name,
      target,
      current: 0
    };

    const updatedGoals = [...goals, newGoal];
    await syncDataInLocalStorageAndDrive(userProfile, transactions, updatedGoals);
    showToast(`Đã thêm mục tiêu tích lũy "${name}"!`, "success");
  };

  const handleFundGoal = async (id: string, amount: number) => {
    if (amount > calculatedBalance) {
      showToast("Số dư ví không đủ để nộp tích lũy!", "error");
      return;
    }

    const targetGoal = goals.find((g) => g.id === id);
    if (!targetGoal) return;

    const added = Math.min(amount, targetGoal.target - targetGoal.current);
    const updatedGoal = { ...targetGoal, current: targetGoal.current + added };

    const goalFundingTx: Transaction = {
      id: Date.now().toString(),
      date: new Date().toISOString(),
      amount: amount,
      category: "Khác",
      note: `Gửi quỹ: ${targetGoal.name}`,
      type: "expense"
    };

    const updatedGoals = goals.map((g) => (g.id === id ? updatedGoal : g));
    const updatedTx = [goalFundingTx, ...transactions];
    await syncDataInLocalStorageAndDrive(userProfile, updatedTx, updatedGoals);
    showToast(`Đã gom thêm ${amount.toLocaleString("vi-VN")} VND vào tiết kiệm!`, "success");
  };

  const handleDeleteGoal = async (id: string) => {
    const updatedGoals = goals.filter((g) => g.id !== id);
    await syncDataInLocalStorageAndDrive(userProfile, transactions, updatedGoals);
    showToast("Đã xóa mục tiêu tích lũy.", "success");
  };

  // ---------------------------------------------------------------------------
  // Computations
  // ---------------------------------------------------------------------------
  const totalExpenses = transactions
    .filter((tx) => tx.type === "expense")
    .reduce((sum, tx) => sum + tx.amount, 0);

  const totalIncomes = transactions
    .filter((tx) => tx.type === "income")
    .reduce((sum, tx) => sum + tx.amount, 0);

  const calculatedBalance = userProfile.total_balance + totalIncomes - totalExpenses;

  const isBroke = totalExpenses > userProfile.monthly_budget * 0.8;
  const isWealthy = totalExpenses < userProfile.monthly_budget * 0.3 && calculatedBalance > 5000000;

  const categorySummary = transactions.reduce((acc: { [key: string]: number }, tx) => {
    if (tx.type === "expense") {
      acc[tx.category] = (acc[tx.category] || 0) + tx.amount;
    }
    return acc;
  }, {});

  const totalExpenseSum = (Object.values(categorySummary) as number[]).reduce((a: number, b: number) => a + b, 0);

  if (!hasSetInitialBalance) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex items-center justify-center p-4 selection:bg-emerald-500/30 selection:text-emerald-300 relative overflow-hidden">
        {/* Decorative background glow elements */}
        <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-emerald-500/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-96 h-96 bg-indigo-550/10 rounded-full blur-[120px] pointer-events-none" />

        <div className="w-full max-w-md relative z-10">
          <div className="text-center mb-6 space-y-3">
            <div className="inline-flex w-16 h-16 rounded-3xl bg-gradient-to-tr from-emerald-600 to-indigo-600 items-center justify-center shadow-2xl shadow-emerald-500/20 mb-1">
              <Sparkles className="w-8 h-8 text-white animate-pulse" />
            </div>
            <div>
              <h1 className="text-2xl font-black uppercase tracking-tight bg-gradient-to-r from-emerald-400 via-teal-300 to-indigo-400 bg-clip-text text-transparent">
                Bét-Phờ-Ren Tài Chính 👋
              </h1>
              <p className="text-xs text-slate-400 mt-1 px-4 leading-relaxed">
                Để bắt đầu hành trình quản lý chi tiêu mượt mà, hãy cài đặt số dư ban đầu trong cấu hình ví của ní nhé!
              </p>
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800/80 rounded-3xl p-6 shadow-2xl backdrop-blur-xl space-y-6">
            <form onSubmit={handleOnboardingSubmit} className="space-y-5">
              <div className="space-y-2">
                <label className="text-xs uppercase font-extrabold tracking-widest text-emerald-400 font-mono flex items-center gap-1.5">
                  <Coins className="w-4 h-4 text-emerald-400" />
                  Số Dư Hiện Tại (VND)
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    autoFocus
                    placeholder="VD: 5.000.000"
                    value={onboardingBalance}
                    onChange={(e) => {
                      const cleaned = e.target.value.replace(/[^0-9]/g, "");
                      setOnboardingBalance(cleaned ? Number(cleaned).toLocaleString("vi-VN") : "");
                    }}
                    className="w-full text-xl p-4 bg-slate-950 border border-slate-805 focus:border-indigo-500 rounded-2xl text-slate-100 focus:outline-none transition font-mono font-black placeholder:text-slate-700 pr-16"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-550 font-mono">
                    VND
                  </span>
                </div>
                
                {/* Clean preset balance buttons */}
                <div className="grid grid-cols-4 gap-2 pt-1">
                  {["500.000", "2.000.000", "5.000.000", "10.000.000"].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setOnboardingBalance(preset)}
                      className="py-1.5 px-1 bg-slate-950/60 hover:bg-slate-900 text-[10px] font-mono font-bold text-slate-400 hover:text-slate-200 border border-slate-850/85 hover:border-slate-800 rounded-xl transition cursor-pointer"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2 pt-1 border-t border-slate-850/60">
                <label className="text-xs uppercase font-extrabold tracking-widest text-indigo-400 font-mono flex items-center gap-1.5">
                  <TrendingDown className="w-4 h-4 text-indigo-400" />
                  Hạn Mức Chi Tiêu Tháng (VND)
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    placeholder="VD: 8.000.000"
                    value={onboardingBudget}
                    onChange={(e) => {
                      const cleaned = e.target.value.replace(/[^0-9]/g, "");
                      setOnboardingBudget(cleaned ? Number(cleaned).toLocaleString("vi-VN") : "");
                    }}
                    className="w-full text-base p-3 bg-slate-950 border border-slate-850 focus:border-indigo-500 rounded-xl text-slate-100 focus:outline-none transition font-mono font-bold placeholder:text-slate-700 pr-16"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500 font-mono">
                    VND
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 italic">
                  *Bét-Phờ-Ren sẽ dùng hạn mức chi tiêu này để tính toán mốc cảnh báo nguy cơ cạn ví nha!
                </p>
              </div>

              <button
                type="submit"
                className="w-full py-4 px-5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 transition-all font-black text-xs flex items-center justify-center gap-2 border border-indigo-700/50 shadow-xl shadow-indigo-600/15 text-white cursor-pointer mt-2"
              >
                <span>Xác nhận & Vào ứng dụng ngay</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>

            <div className="pt-4 border-t border-slate-850 bg-slate-950/20 rounded-b-2xl flex flex-col items-center gap-2.5">
              <span className="text-[11px] text-slate-400 font-medium">Bạn đã có bản sao lưu trên Drive?</span>
              <button
                type="button"
                onClick={handleGoogleSignIn}
                className="w-full py-2 px-3 bg-slate-900 border border-slate-850 hover:border-indigo-500 hover:bg-slate-950 rounded-xl text-xs flex items-center justify-center gap-2 text-indigo-300 font-bold transition cursor-pointer"
              >
                <Database className="w-3.5 h-3.5" />
                <span>Khôi phục dữ liệu từ Google Drive</span>
              </button>
            </div>
          </div>
          
          <div className="text-center mt-6 text-[10px] text-slate-505 font-mono">
            Vui lòng cài đặt số dư ban đầu để bét-phờ-ren hỗ trợ tính toán chính xác số dư hiện tại của bạn nhé.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-emerald-500/30 selection:text-emerald-300">
      
      {/* 1. Global Navigation Bar */}
      <header className="border-b border-slate-900/80 bg-slate-950/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-emerald-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-emerald-500/10">
              <Sparkles className="w-5 h-5 text-white animate-pulse" />
            </div>
            <div>
              <h1 className="text-sm font-black tracking-tight uppercase bg-gradient-to-r from-emerald-400 via-teal-300 to-indigo-400 bg-clip-text text-transparent">
                Expense Tracker AI
              </h1>
              <p className="text-[10px] text-slate-400 font-mono tracking-wider font-bold">
                DRIVE & LOCAL STORAGE SYNC
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Connection Status Flag */}
            <div className="hidden sm:flex items-center gap-2 pr-2">
              <span className={`w-2.5 h-2.5 rounded-full ${
                googleAccessToken 
                  ? "bg-emerald-400 shadow-md shadow-emerald-450/50 animate-pulse" 
                  : user 
                    ? "bg-amber-400 shadow-md shadow-amber-400/50" 
                    : "bg-indigo-500/80"
              }`}></span>
              <span className="text-[10px] font-mono font-extrabold uppercase tracking-widest text-slate-400">
                {googleAccessToken 
                  ? "Drive Sync Active" 
                  : user 
                    ? "Drive Authenticating" 
                    : "Local Storage Mode"}
              </span>
            </div>

            {authLoading ? (
              <span className="text-xs text-slate-500 animate-pulse">Đang nạp...</span>
            ) : user ? (
              <div className="flex items-center gap-2.5">
                {/* User avatar / identifier */}
                <div className="flex items-center gap-2 p-1.5 pl-2.5 pr-2 rounded-xl bg-slate-900/90 border border-slate-800">
                  <div className="text-right">
                    <p className="text-[10px] font-bold text-slate-200 line-clamp-1">{user.displayName || "Sếp"}</p>
                    <p className="text-[9px] text-slate-500 line-clamp-1 font-mono">{user.email}</p>
                  </div>
                  {user.photoURL ? (
                    <img 
                      src={user.photoURL} 
                      alt="Avatar" 
                      referrerPolicy="no-referrer"
                      className="w-7 h-7 rounded-lg object-cover border border-slate-800" 
                    />
                  ) : (
                    <div className="w-7 h-7 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center border border-indigo-500/20">
                      <UserIcon className="w-4 h-4" />
                    </div>
                  )}
                </div>

                <button
                  onClick={handleSignOut}
                  className="p-2.5 rounded-xl bg-slate-900 hover:bg-rose-500/10 border border-slate-800 hover:border-rose-500/20 text-slate-400 hover:text-rose-400 transition"
                  title="Đăng xuất tài khoản"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={handleGoogleSignIn}
                className="p-1 px-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 hover:shadow-lg hover:shadow-indigo-500/10 text-xs text-white font-black transition flex items-center gap-1.5 cursor-pointer"
              >
                <Database className="w-3.5 h-3.5" /> Đồng bộ Cloud
              </button>
            )}
          </div>
        </div>
      </header>

      {/* 2. Toast Notifications block */}
      {notification && (
        <div className="fixed bottom-6 right-6 z-50 animate-bounce">
          <div className={`p-3.5 px-5 rounded-2xl shadow-2xl border text-xs font-semibold flex items-center gap-2.5 ${
            notification.type === "error" 
              ? "bg-rose-950/90 border-rose-800 text-rose-300"
              : notification.type === "info"
                ? "bg-indigo-950/90 border-indigo-850 text-indigo-300"
                : "bg-emerald-950/90 border-emerald-800 text-emerald-300"
          }`}>
            <span className="w-1.5 h-1.5 rounded-full bg-current animate-ping"></span>
            <span>{notification.text}</span>
          </div>
        </div>
      )}

      {/* 3. Main Dashboard Body */}
      <main className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* LEFT COLUMN: Input & AI parsing Interaction (5 columns) */}
        <section className="lg:col-span-5 space-y-6">
          
          {/* Card: Total Available Balance Summary with interactive styling */}
          <div className="relative overflow-hidden bg-gradient-to-tr from-slate-900 to-slate-950 border border-slate-800 rounded-2xl p-6 shadow-xl">
            <div className="absolute top-0 right-0 p-8 text-emerald-500/5 rotate-12 select-none font-black text-7xl font-mono">
              VND
            </div>
            
            <div className="relative z-10 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold tracking-widest text-emerald-400 font-mono">
                  Số Dư Dự Kiến
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setOnboardingBalance(userProfile.total_balance.toLocaleString("vi-VN"));
                    setOnboardingBudget(userProfile.monthly_budget.toLocaleString("vi-VN"));
                    setHasSetInitialBalance(false);
                  }}
                  className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer font-bold bg-slate-950/60 p-1 px-2.5 border border-slate-850 rounded-lg hover:bg-slate-950 transition-all font-sans"
                  title="Thay đổi cài đặt số dư ban đầu"
                >
                  <RefreshCw className="w-3 h-3 text-indigo-405" /> Cài đặt số dư
                </button>
              </div>
              <h2 className="text-3xl font-black text-white leading-none tracking-tight">
                {calculatedBalance.toLocaleString("vi-VN")} <span className="text-lg font-bold text-slate-400">VND</span>
              </h2>
              <div className="flex items-center gap-2 pt-2.5 text-xs text-slate-400 font-medium">
                <span className="flex items-center gap-1 bg-emerald-500/10 text-emerald-400 p-1 px-2 rounded-lg text-[11px]">
                  <Coins className="w-3 h-3" /> Thu: {totalIncomes.toLocaleString("vi-VN")}
                </span>
                <span className="flex items-center gap-1 bg-rose-500/10 text-rose-400 p-1 px-2 rounded-lg text-[11px]">
                  <TrendingDown className="w-3 h-3" /> Chi: {totalExpenses.toLocaleString("vi-VN")}
                </span>
              </div>
            </div>
          </div>

          {/* Google Drive Active Sync Center */}
          <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/40 backdrop-blur-sm space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {googleAccessToken ? (
                  <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-450 flex items-center justify-center border border-emerald-550/20 shadow-lg shadow-emerald-500/5">
                    <Cloud className="w-4 h-4 text-emerald-400" />
                  </div>
                ) : (
                  <div className="w-8 h-8 rounded-xl bg-slate-950 text-slate-500 flex items-center justify-center border border-slate-800">
                    <CloudLightning className="w-4 h-4 text-indigo-400" />
                  </div>
                )}
                <div>
                  <h4 className="text-xs font-bold text-slate-100 font-sans">Đồng bộ Google Drive</h4>
                  <p className="text-[10px] text-slate-500 font-mono tracking-wider font-bold">
                    {googleAccessToken ? "🟢 FULLY CONNECTED" : "⚪ OFFLINE LOCAL DEVICE"}
                  </p>
                </div>
              </div>

              {googleAccessToken && (
                <span className="text-[9px] uppercase font-mono font-extrabold px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Active
                </span>
              )}
            </div>

            {googleAccessToken ? (
              <div className="space-y-3">
                <div className="p-3 bg-slate-950/70 border border-slate-900 rounded-xl space-y-2 text-[11px] text-slate-400 font-mono leading-relaxed">
                  <div className="flex justify-between items-center">
                    <span>Trạng thái tệp:</span>
                    <span className="text-slate-200 text-right truncate max-w-40 font-semibold">
                      {driveFileId ? `ID: ${driveFileId.slice(0, 8)}...` : "Khởi tạo tự động"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Lần đồng bộ cuối:</span>
                    <span className="text-slate-200 text-right font-semibold">{lastDriveSync || "Chưa lưu trong phiên"}</span>
                  </div>
                  <div className="flex justify-between items-center pt-2 border-t border-slate-900">
                    <span className="font-semibold text-slate-350">Tự động Sao lưu:</span>
                    <button
                      onClick={() => setAutoSaveEnabled(!autoSaveEnabled)}
                      className={`text-[10px] p-1 px-2.5 rounded font-bold cursor-pointer transition ${
                        autoSaveEnabled 
                          ? "bg-emerald-555/20 text-emerald-400 border border-emerald-500/30" 
                          : "bg-slate-800 text-slate-500 border border-slate-700"
                      }`}
                    >
                      {autoSaveEnabled ? "BẬT (Khuyên dùng)" : "TẮT"}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  <button
                    onClick={() => syncWithGoogleDrive(googleAccessToken, "upload")}
                    disabled={isSyncing}
                    className="py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-950 disabled:text-slate-700 text-white font-heavy text-xs flex items-center justify-center gap-1.5 cursor-pointer border border-indigo-750 transition shadow-lg shadow-indigo-600/10"
                    title="Sao lưu toàn bộ số dư và giao dịch hiện tại lên ổ Google Drive của bạn"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Sao lưu (Up)</span>
                  </button>

                  <button
                    onClick={() => syncWithGoogleDrive(googleAccessToken, "download")}
                    disabled={isSyncing}
                    className="py-2.5 px-3 rounded-xl bg-slate-940 hover:bg-slate-900 disabled:bg-slate-905 disabled:text-slate-700 text-slate-200 font-heavy text-xs flex items-center justify-center gap-1.5 cursor-pointer border border-slate-850 transition"
                    title="Khôi phục toàn bộ số dư và giao dịch từ ổ Google Drive về trình duyệt"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Khôi phục (Down)</span>
                  </button>
                </div>
              </div>
            ) : user ? (
              <div className="space-y-3 font-sans">
                <p className="text-[11px] text-slate-405 leading-relaxed font-medium">
                  Phiên đăng nhập đang sẵn sàng, nhưng ổ đĩa Google Drive chưa được mở khóa/cấp phép ở cửa sổ duyệt hiện tại (Token bảo mật giữ trong Ram).
                </p>
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={isSyncing}
                  className="w-full py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer border border-indigo-750 transition shadow-lg shadow-indigo-600/10"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? "animate-spin" : ""}`} />
                  Mở khóa & Đồng bộ Drive
                </button>
              </div>
            ) : (
              <div className="space-y-3 font-sans">
                <p className="text-[11px] text-slate-400 leading-relaxed font-medium">
                  Ứng dụng đang vận hành hoàn toàn ở Ngoại tuyến. Hãy đăng nhập để kích hoạt đồng bộ chủ động 2 chiều lên hòm Google Drive bảo mật của riêng bạn.
                </p>
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={isSyncing}
                  className="w-full py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-505 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer border border-indigo-750 transition shadow-lg shadow-indigo-600/10"
                >
                  <Cloud className="w-3.5 h-3.5" />
                  Đồng bộ Google Drive
                </button>
              </div>
            )}

            <div className="pt-2 border-t border-slate-900/60 text-[9px] text-slate-500 leading-normal flex items-start gap-1 font-mono">
              <Info className="w-3 h-3 text-slate-600 shrink-0 mt-0.5" />
              <span>DỮ LIỆU CỦA BẠN, DRIVE CỦA BẠN: Hòm Cloud Firebase của quản trị viên chỉ xử lý xác thực đăng nhập, không lưu trữ sổ sách của bạn.</span>
            </div>
          </div>

          {/* Card: Voice / Text Entry input portal */}
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-6 shadow-xl backdrop-blur-md space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1">
              <div>
                <h3 className="text-sm font-bold text-slate-100 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  Ghi Chép Giao Dịch
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">Thêm nhanh khoản tiền nhận được hoặc chi tiêu thủ công/bằng AI</p>
              </div>

              <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-850/80 self-start sm:self-auto shrink-0">
                <button
                  type="button"
                  onClick={() => setInputTab("ai")}
                  className={`py-1 px-3 text-[10px] font-bold rounded-lg transition-all cursor-pointer ${
                    inputTab === "ai" 
                      ? "bg-indigo-600 text-white shadow shadow-indigo-600/20" 
                      : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  Giọng nói & AI
                </button>
                <button
                  type="button"
                  onClick={() => setInputTab("manual")}
                  className={`py-1 px-3 text-[10px] font-bold rounded-lg transition-all cursor-pointer ${
                    inputTab === "manual" 
                      ? "bg-indigo-600 text-white shadow shadow-indigo-600/20" 
                      : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  Ghi thủ công ✍️
                </button>
              </div>
            </div>

            {inputTab === "ai" ? (
              /* Input Form layout for AI Entry */
              <div className="space-y-3">
                <div className="relative">
                  <textarea
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="VD: Được mẹ cho 200k sướng quá..."
                    disabled={isAiLoading}
                    className="w-full h-24 text-xs p-3.5 pr-14 bg-slate-950 border border-slate-800 rounded-xl leading-relaxed text-slate-100 focus:outline-none focus:border-indigo-400 transition placeholder:text-slate-600 resize-none font-medium"
                  />

                  <div className="absolute right-3.5 bottom-3.5 flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={toggleRecording}
                      className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
                        isRecording 
                          ? "bg-rose-600 border-rose-500 text-white animate-pulse" 
                          : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700"
                      }`}
                      title={isRecording ? "Đang ghi âm... Nhấp lần nữa để tắt" : "Bật micro ghi âm bằng giọng nói"}
                    >
                      {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* simulated voices shortcuts tab for manual testing */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setShowSimPresets(!showSimPresets)}
                      className="text-[10px] uppercase font-bold tracking-wider text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                      {showSimPresets ? "Ẩn danh sách thử nghiệm" : "Dùng văn bản nói thử nghiệm"}
                    </button>
                    
                    {isRecording && (
                      <span className="text-[10px] text-rose-400 font-bold animate-pulse">
                        🔴 ĐANG LẮNG NGHE GIỌNG NÓI...
                      </span>
                    )}
                  </div>

                  {showSimPresets && (
                    <div className="p-2.5 bg-slate-950/60 border border-slate-850 rounded-xl max-h-40 overflow-y-auto space-y-1.5 custom-scrollbar">
                      <p className="text-[10px] text-slate-500 italic pb-1">
                        *Nhấp chọn câu bất kỳ dưới đây để giả điều kiện giọng nói/dịch thuật:
                      </p>
                      {SIMULATED_VOICES.map((line, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            setInputText(line);
                            setShowSimPresets(false);
                          }}
                          className="w-full text-left text-xs p-1.5 px-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition truncate font-mono cursor-pointer"
                        >
                          "{line}"
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Trigger conversion action button */}
                <button
                  type="button"
                  onClick={() => handleParseTransaction(inputText)}
                  disabled={isAiLoading || !inputText.trim()}
                  className="w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-900 disabled:text-slate-600 transition text-xs font-bold flex items-center justify-center gap-2 border border-indigo-700/50 shadow-lg shadow-indigo-600/10 cursor-pointer"
                >
                  <span>Xác nhận giao dịch với Gemini</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            ) : (
              /* Manual form when tab is manual */
              <form onSubmit={handleAddManualTransaction} className="space-y-3.5">
                {/* Transaction Type selection (Expense vs. Income) */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setManualType("income");
                      setManualCategory("Thu nhập");
                    }}
                    className={`py-2 px-3 rounded-lg border text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      manualType === "income"
                        ? "bg-emerald-500/15 border-emerald-500/60 text-emerald-400 font-heavy shadow-sm shadow-emerald-500/5"
                        : "bg-slate-950/40 border-slate-850 text-slate-500 hover:text-slate-350"
                    }`}
                  >
                    <Coins className="w-3.5 h-3.5" />
                    Nhận Tiền (+ Thu)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setManualType("expense");
                      if (manualCategory === "Thu nhập") {
                        setManualCategory("Ăn uống");
                      }
                    }}
                    className={`py-2 px-3 rounded-lg border text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      manualType === "expense"
                        ? "bg-rose-500/10 border-rose-500/40 text-rose-450 font-heavy"
                        : "bg-slate-950/40 border-slate-850 text-slate-500 hover:text-slate-350"
                    }`}
                  >
                    <TrendingDown className="w-3.5 h-3.5" />
                    Chi Tiêu (- Chi)
                  </button>
                </div>

                {/* Amount and Category fields side by side */}
                <div className="grid grid-cols-2 gap-3 pb-0.5">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold tracking-wider text-slate-500 font-mono">Số tiền (VND)</label>
                    <input
                      type="text"
                      required
                      placeholder="VD: 50.000"
                      value={manualAmount}
                      onChange={(e) => {
                        const cleaned = e.target.value.replace(/[^0-9]/g, "");
                        setManualAmount(cleaned ? Number(cleaned).toLocaleString("vi-VN") : "");
                      }}
                      className="w-full text-xs p-2.5 bg-slate-950 border border-slate-850 rounded-xl leading-relaxed text-slate-100 focus:outline-none focus:border-indigo-500 transition font-mono font-bold"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Danh mục</label>
                    <select
                      value={manualCategory}
                      onChange={(e) => setManualCategory(e.target.value)}
                      className="w-full text-xs p-2.5 bg-slate-950 border border-slate-850 rounded-xl leading-relaxed text-slate-100 focus:outline-none focus:border-indigo-500 transition cursor-pointer font-medium"
                    >
                      {manualType === "income" ? (
                        <>
                          <option value="Thu nhập">Thu nhập (Lương, Thưởng, Lộc)</option>
                          <option value="Khác">Khoản Thu Khác</option>
                        </>
                      ) : (
                        <>
                          <option value="Ăn uống">Ăn uống 🥤</option>
                          <option value="Di chuyển">Di chuyển 🛵</option>
                          <option value="Mua sắm">Mua sắm 🛍️</option>
                          <option value="Nhà ở & Hóa đơn">Nhà ở & Hóa đơn 🏠</option>
                          <option value="Học tập">Học tập 📚</option>
                          <option value="Giải trí">Giải trí 🎉</option>
                          <option value="Sức khỏe">Sức khỏe 💪</option>
                          <option value="Khác">Mục Chi Khác 💸</option>
                        </>
                      )}
                    </select>
                  </div>
                </div>

                {/* Note description input */}
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Nội dung ghi chú</label>
                  <input
                    type="text"
                    required
                    placeholder={manualType === "income" ? "Ví dụ: Lương tháng 6, được bố cho, thưởng nóng..." : "Ví dụ: Đi bún chả, nạp thẻ game, mua quần áo..."}
                    value={manualNote}
                    onChange={(e) => setManualNote(e.target.value)}
                    className="w-full text-xs p-3 bg-slate-950 border border-slate-850 rounded-xl leading-relaxed text-slate-100 focus:outline-none focus:border-indigo-500 transition placeholder:text-slate-750 font-medium"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 transition text-xs font-bold flex items-center justify-center gap-2 border border-indigo-750 shadow-lg shadow-indigo-600/15 cursor-pointer text-white"
                >
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                  <span>Xác nhận Ghi Sổ ngay ({manualType === "income" ? "Khoản Thu" : "Khoản Chi"})</span>
                </button>
              </form>
            )}
          </div>


          {/* AI mascot feedback bubble chat */}
          <AIBuddyAvatar 
            reply={aiReply}
            isBroke={isBroke}
            isWealthy={isWealthy}
            isLoading={isAiLoading}
            error={aiError}
          />

          {/* Card: Simple category percentages chart */}
          {totalExpenseSum > 0 && (
            <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-5 shadow-xl backdrop-blur-md space-y-4">
              <div>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Cộng dồn chi tiêu danh mục</h4>
              </div>

              <div className="space-y-3">
                {(Object.entries(categorySummary) as [string, number][]).map(([cat, amt]) => {
                  const perc = totalExpenseSum > 0 ? Math.round((amt / totalExpenseSum) * 100) : 0;
                  return (
                    <div key={cat} className="space-y-1">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-medium text-slate-200">{cat}</span>
                        <span className="text-slate-400 font-bold">{amt.toLocaleString("vi-VN")} đ ({perc}%)</span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-slate-950 overflow-hidden">
                        <div 
                          className="h-full bg-indigo-500 rounded-full" 
                          style={{ width: `${perc}%` }}
                        ></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </section>

        {/* RIGHT COLUMN: Details & history analytics (7 columns) */}
        <section className="lg:col-span-7 space-y-6">
          
          {/* Card section: Budget & Savings planning */}
          <BudgetGoalWidgets 
            userProfile={userProfile}
            goals={goals}
            onUpdateBudget={handleUpdateBudget}
            onAddGoal={handleAddGoal}
            onFundGoal={handleFundGoal}
            onDeleteGoal={handleDeleteGoal}
            totalExpenses={totalExpenses}
          />

          {/* Card section: Transaction列表 with custom categories */}
          <TransactionList 
            transactions={transactions}
            onDeleteTransaction={handleDeleteTransaction}
          />

        </section>

      </main>

      {/* 4. Elegant Credit line */}
      <footer className="py-8 text-center text-xs text-slate-600 border-t border-slate-900/60 mt-12 space-y-1">
        <p>© 2026 AI Expense Tracker - Secure Firebase Database with real-time sync.</p>
        <p className="font-mono text-[10px] text-slate-700">Powered by Gemini 3.5 & Google Developer Services</p>
      </footer>

      {/* 5. Clean, Hardened Popup Blocker Troubleshooting Modal */}
      {popupError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md animate-fade-in">
          <div className="bg-slate-900 border border-indigo-500/20 shadow-2xl shadow-indigo-500/10 rounded-3xl max-w-lg w-full p-6 md:p-8 space-y-6 relative overflow-hidden">
            
            {/* Ambient background decoration */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 rounded-full blur-3xl -mr-10 -mt-10"></div>
            
            <button 
              onClick={() => setPopupError(false)}
              className="absolute top-4 right-4 p-2 text-slate-550 hover:text-slate-300 bg-slate-950/40 hover:bg-slate-950/80 rounded-full border border-slate-800 transition cursor-pointer"
              title="Đóng chỉ dẫn"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Modal Icon and Header */}
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center border border-indigo-500/20 shadow-lg shadow-indigo-500/5">
                <Lock className="w-8 h-8 animate-pulse text-indigo-300" />
              </div>
              
              <div className="space-y-1.5">
                <h3 className="text-lg font-extrabold tracking-tight text-white">
                  Cửa Sổ Đăng Nhập Bị Trình Duyệt Chặn
                </h3>
                <p className="text-xs text-indigo-400 font-bold uppercase tracking-widest font-mono">
                  POPUP BLOCKED DETECTED
                </p>
              </div>
            </div>

            {/* Modal Explanatory Content */}
            <div className="text-xs text-slate-300 leading-relaxed space-y-4 bg-slate-950/50 p-4 rounded-xl border border-slate-800">
              <p>
                Bạn đang trải nghiệm ứng dụng từ trong khung mô phỏng bảo mật (iFrame) của Google AI Studio. Trình duyệt của bạn sẽ tự động chặn các popup bật lên để tránh lừa đảo giả mạo.
              </p>
              <p className="font-semibold text-indigo-300 flex items-start gap-1.5 pt-1.5">
                <Info className="w-4 h-4 shrink-0 text-indigo-400 mt-0.5" />
                <span>Bạn sẽ KHÔNG bị mất dữ liệu hiện tại khi mở ứng dụng ở tab mới. Toàn bộ thiết lập của bạn vẫn được giữ nguyên!</span>
              </p>
            </div>

            {/* Action buttons */}
            <div className="space-y-3">
              <a
                href={typeof window !== "undefined" ? window.location.href : "#"}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setPopupError(false)}
                className="w-full py-3.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black transition flex items-center justify-center gap-2 border border-indigo-700/50 shadow-lg shadow-indigo-500/10 cursor-pointer text-center"
              >
                <span>Mở ứng dụng ở tab mới (Khuyên dùng)</span>
                <ExternalLink className="w-4 h-4" />
              </a>

              <div className="py-2 text-[11px] text-slate-400 text-center border-t border-slate-850/60 font-medium">
                Hoặc cho phép thủ công bằng cách click vào biểu tượng <span className="text-indigo-400 font-bold">Popup Blocked 🚫</span> ở góc phải thanh địa chỉ trình duyệt của bạn và chọn <span className="text-indigo-400 font-bold">Luôn cho phép (Always allow)</span>.
              </div>

              <div className="flex gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setPopupError(false);
                  }}
                  className="w-full py-2.5 px-4 text-[11px] text-slate-400 hover:text-slate-200 bg-slate-950 hover:bg-slate-900 border border-slate-850 text-center font-bold rounded-xl transition cursor-pointer"
                >
                  Bỏ qua & Tiếp tục dùng Ngoại tuyến
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* 6. Clean, Hardened Unauthorized Domain Troubleshooting Modal */}
      {domainError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md animate-fade-in">
          <div className="bg-slate-900 border border-emerald-500/20 shadow-2xl shadow-emerald-500/10 rounded-3xl max-w-lg w-full p-6 md:p-8 space-y-6 relative overflow-hidden">
            
            {/* Ambient background decoration */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-3xl -mr-10 -mt-10"></div>
            
            <button 
              onClick={() => setDomainError(false)}
              className="absolute top-4 right-4 p-2 text-slate-550 hover:text-slate-300 bg-slate-950/40 hover:bg-slate-950/80 rounded-full border border-slate-800 transition cursor-pointer"
              title="Đóng chỉ dẫn"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Modal Icon and Header */}
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center border border-emerald-500/20 shadow-lg shadow-emerald-500/5">
                <CloudLightning className="w-8 h-8 animate-pulse text-emerald-300" />
              </div>
              
              <div className="space-y-1.5">
                <h3 className="text-lg font-extrabold tracking-tight text-white">
                  Tên Miền Chưa Được Cấu Hình Xác Thực
                </h3>
                <p className="text-xs text-emerald-400 font-bold uppercase tracking-widest font-mono">
                  UNAUTHORIZED DOMAIN DETECTED
                </p>
              </div>
            </div>

            {/* Modal Explanatory Content */}
            <div className="text-xs text-slate-300 leading-relaxed space-y-4 bg-slate-950/50 p-4 rounded-xl border border-slate-800 font-medium">
              <p>
                Để bảo mật, Firebase Authentication yêu cầu bạn phải phê duyệt miền đang truy cập trước khi mở hộp thoại đăng nhập Google.
              </p>
              <div>
                <p className="text-emerald-400 font-bold mb-1 uppercase tracking-wider text-[10px]">Tên miền cần đưa vào danh sách cho phép (Authorized Domain):</p>
                <code className="block p-2 bg-slate-950 border border-slate-850 rounded-lg text-rose-300 select-all font-mono break-all text-center">
                  {typeof window !== "undefined" ? window.location.hostname : "ais-dev-geyypol5w3zflhpgw2fdnm-948959852711.asia-southeast1.run.app"}
                </code>
              </div>
              <div className="space-y-2 pt-1 border-t border-slate-800">
                <p className="font-bold flex items-center gap-1.5 text-slate-250">
                  <span className="w-5 h-5 rounded bg-emerald-500/10 text-emerald-400 flex items-center justify-center text-[10px] font-mono font-bold">1</span>
                  <span>Nhấp vào nút liên kết Firebase Console bên dưới.</span>
                </p>
                <p className="font-bold flex items-center gap-1.5 text-slate-250">
                  <span className="w-5 h-5 rounded bg-emerald-500/10 text-emerald-400 flex items-center justify-center text-[10px] font-mono font-bold">2</span>
                  <span>Chọn <strong>Thêm miền (Add domain)</strong> và dán miền phía trên vào rồi lưu lại. Sẵn sàng hoạt động ngay lập tức!</span>
                </p>
              </div>
            </div>

            {/* Action buttons */}
            <div className="space-y-3">
              <a
                href={`https://console.firebase.google.com/project/${firebaseConfig.projectId}/authentication/settings`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-3.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black transition flex items-center justify-center gap-2 border border-emerald-700/50 shadow-lg shadow-emerald-500/10 cursor-pointer text-center"
              >
                <span>Mở Firebase Auth Settings</span>
                <ExternalLink className="w-4 h-4" />
              </a>

              <div className="flex gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setDomainError(false);
                  }}
                  className="w-full py-2.5 px-4 text-[11px] text-slate-400 hover:text-slate-200 bg-slate-950 hover:bg-slate-900 border border-slate-850 text-center font-bold rounded-xl transition cursor-pointer"
                >
                  Đóng & Tiếp tục dùng ngoại tuyến
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
