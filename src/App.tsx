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
  CloudLightning
} from "lucide-react";
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut, User } from "firebase/auth";
import { doc, setDoc, deleteDoc, collection, onSnapshot, getDocFromServer } from "firebase/firestore";
import { Transaction, UserProfile, Goal } from "./types";
import { auth, db, handleFirestoreError, OperationType } from "./firebase";
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

  // UI States
  const [showSimPresets, setShowSimPresets] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [notification, setNotification] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);

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

  // 2. Track Firebase Auth state change and coordinate merging / data loading
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);

      if (currentUser) {
        showToast(`Chào mừng quay trở lại, ${currentUser.displayName || "Sếp"}!`, "success");
        // Trigger automated cloud sync checks
        setIsSyncing(true);
      } else {
        // Fallback to local storage when not authenticated
        const savedProfile = localStorage.getItem("expense_tracker_profile");
        const savedTx = localStorage.getItem("expense_tracker_tx");
        const savedGoals = localStorage.getItem("expense_tracker_goals");

        if (savedProfile) setUserProfile(JSON.parse(savedProfile));
        else setUserProfile(INITIAL_PROFILE);

        if (savedTx) setTransactions(JSON.parse(savedTx));
        else setTransactions([]);

        if (savedGoals) setGoals(JSON.parse(savedGoals));
        else setGoals([]);
      }
    });

    return () => unsubscribe();
  }, []);

  // 3. Keep real-time Firestore collections synchronized in real-time when authenticated!
  useEffect(() => {
    if (!user) return;

    setIsSyncing(true);

    // Profile subscription
    const profileRef = doc(db, "users", user.uid);
    const unsubProfile = onSnapshot(profileRef, (snapshot) => {
      if (snapshot.exists()) {
        setUserProfile(snapshot.data() as UserProfile);
      } else {
        // First log in with zero Firestore records: upload current local storage state as initial base profile
        const localProfStr = localStorage.getItem("expense_tracker_profile");
        const baseProfile = localProfStr ? JSON.parse(localProfStr) : INITIAL_PROFILE;
        
        setDoc(profileRef, {
          userId: user.uid,
          total_balance: baseProfile.total_balance,
          currency: baseProfile.currency,
          monthly_budget: baseProfile.monthly_budget
        })
          .then(() => {
            // Also merge any existing offline transactions and goals to cloud
            mergeOfflineDataToCloud(user.uid);
          })
          .catch((err) => handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`));
      }
      setIsSyncing(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
      setIsSyncing(false);
    });

    // Subscriptions for transactions subcollection
    const txCol = collection(db, "users", user.uid, "transactions");
    const unsubTx = onSnapshot(txCol, (snapshot) => {
      const list: Transaction[] = [];
      snapshot.forEach((doc) => {
        list.push(doc.data() as Transaction);
      });
      // Sort desc
      list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setTransactions(list);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}/transactions`);
    });

    // Subscriptions for goals subcollection
    const goalsCol = collection(db, "users", user.uid, "goals");
    const unsubGoals = onSnapshot(goalsCol, (snapshot) => {
      const list: Goal[] = [];
      snapshot.forEach((doc) => {
        list.push(doc.data() as Goal);
      });
      setGoals(list);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}/goals`);
    });

    return () => {
      unsubProfile();
      unsubTx();
      unsubGoals();
    };
  }, [user]);

  // Merge local data tool on initial login so no data is ever lost
  const mergeOfflineDataToCloud = async (userId: string) => {
    const savedTxStr = localStorage.getItem("expense_tracker_tx");
    const savedGoalsStr = localStorage.getItem("expense_tracker_goals");

    if (savedTxStr) {
      const items: Transaction[] = JSON.parse(savedTxStr);
      for (const item of items) {
        try {
          await setDoc(doc(db, `users/${userId}/transactions`, item.id), item);
        } catch (e) {
          console.error("Merging transaction failed", e);
        }
      }
    }

    if (savedGoalsStr) {
      const items: Goal[] = JSON.parse(savedGoalsStr);
      for (const item of items) {
        try {
          await setDoc(doc(db, `users/${userId}/goals`, item.id), item);
        } catch (e) {
          console.error("Merging goal failed", e);
        }
      }
    }
    showToast("Đã đồng bộ hóa an toàn toàn bộ dữ liệu ngoại tuyến hiện tại lên Cloud!", "success");
  };

  // Local-storage file persistence (used as fallback or sync cache)
  const saveStateLocally = (newProfile: UserProfile, newTx: Transaction[], newGoals: Goal[]) => {
    localStorage.setItem("expense_tracker_profile", JSON.stringify(newProfile));
    localStorage.setItem("expense_tracker_tx", JSON.stringify(newTx));
    localStorage.setItem("expense_tracker_goals", JSON.stringify(newGoals));
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
    try {
      setIsSyncing(true);
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      console.error("Sign-In popup failed:", err);
      showToast(`Đăng nhập thất bại: ${err.message}`, "error");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSignOut = async () => {
    const ok = window.confirm("Xác nhận đăng xuất tài khoản? Ứng dụng sẽ chuyển lại chế độ Lưu trữ Nội bộ.");
    if (!ok) return;

    try {
      await signOut(auth);
      setTransactions([]);
      setGoals([]);
      setUserProfile(INITIAL_PROFILE);
      showToast("Đã đăng xuất ra khỏi tài khoản đám mây.", "info");
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

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Gặp sự cố khi kết nối Gemini AI.");
      }

      const parsedResult = await response.json();

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

    if (user) {
      try {
        const txRef = doc(db, `users/${user.uid}/transactions`, newTx.id);
        await setDoc(txRef, newTx);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}/transactions/${newTx.id}`);
      }
    } else {
      const updatedTx = [newTx, ...transactions];
      setTransactions(updatedTx);
      saveStateLocally(userProfile, updatedTx, goals);
    }
  };

  // ---------------------------------------------------------------------------
  // Action Event Dispatchers
  // ---------------------------------------------------------------------------
  const handleDeleteTransaction = async (id: string) => {
    if (user) {
      try {
        const txRef = doc(db, `users/${user.uid}/transactions`, id);
        await deleteDoc(txRef);
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `users/${user.uid}/transactions/${id}`);
      }
    } else {
      const updatedTx = transactions.filter((tx) => tx.id !== id);
      setTransactions(updatedTx);
      saveStateLocally(userProfile, updatedTx, goals);
    }
    showToast("Đã xóa giao dịch thành công.", "success");
  };

  const handleUpdateBudget = async (newBudget: number) => {
    const updatedProfile = { ...userProfile, monthly_budget: newBudget };
    setUserProfile(updatedProfile);
    saveStateLocally(updatedProfile, transactions, goals);

    if (user) {
      try {
        const profileRef = doc(db, "users", user.uid);
        await setDoc(profileRef, {
          userId: user.uid,
          monthly_budget: newBudget,
          total_balance: userProfile.total_balance,
          currency: "VND"
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`);
      }
    }
    showToast("Cập nhật hạn mức chi tiêu thành công!", "success");
  };

  const handleAddGoal = async (name: string, target: number) => {
    const newGoal: Goal = {
      id: Date.now().toString(),
      name,
      target,
      current: 0
    };

    if (user) {
      try {
        const goalRef = doc(db, `users/${user.uid}/goals`, newGoal.id);
        await setDoc(goalRef, newGoal);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}/goals/${newGoal.id}`);
      }
    } else {
      const updatedGoals = [...goals, newGoal];
      setGoals(updatedGoals);
      saveStateLocally(userProfile, transactions, updatedGoals);
    }
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

    if (user) {
      try {
        const goalRef = doc(db, `users/${user.uid}/goals`, id);
        const txRef = doc(db, `users/${user.uid}/transactions`, goalFundingTx.id);

        await setDoc(goalRef, updatedGoal);
        await setDoc(txRef, goalFundingTx);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`);
      }
    } else {
      const updatedGoals = goals.map((g) => (g.id === id ? updatedGoal : g));
      const updatedTx = [goalFundingTx, ...transactions];
      setGoals(updatedGoals);
      setTransactions(updatedTx);
      saveStateLocally(userProfile, updatedTx, updatedGoals);
    }
    showToast(`Đã gom thêm ${amount.toLocaleString("vi-VN")} VND vào tiết kiệm!`, "success");
  };

  const handleDeleteGoal = async (id: string) => {
    if (user) {
      try {
        const goalRef = doc(db, `users/${user.uid}/goals`, id);
        await deleteDoc(goalRef);
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `users/${user.uid}/goals/${id}`);
      }
    } else {
      const updatedGoals = goals.filter((g) => g.id !== id);
      setGoals(updatedGoals);
      saveStateLocally(userProfile, transactions, updatedGoals);
    }
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
              <p className="text-[10px] text-slate-500 font-mono tracking-wider font-semibold">
                SECURE FIREBASE BACKEND
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Connection Status Flag */}
            <div className="hidden sm:flex items-center gap-2 pr-2">
              <span className={`w-2.5 h-2.5 rounded-full ${user ? "bg-emerald-400 shadow-md shadow-emerald-400/50" : "bg-indigo-500/80 animate-pulse"}`}></span>
              <span className="text-[10px] font-mono font-extrabold uppercase tracking-widest text-slate-400">
                {user ? "Cloud Synced" : "Sandboxed Local Mode"}
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
              <span className="text-[10px] uppercase font-bold tracking-widest text-emerald-400 font-mono">
                Số Dư Dự Kiến
              </span>
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

          {/* Secure Firebase Account banner if guest */}
          {!user && (
            <div className="p-4 rounded-2xl border border-indigo-500/20 bg-indigo-500/5 flex items-center justify-between gap-4">
              <div className="flex gap-2.5">
                <div className="p-2 h-fit bg-indigo-500/10 rounded-xl text-indigo-400">
                  <CloudLightning className="w-4 h-4 animate-bounce" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-200">Lưu trữ Ngoại tuyến Cục bộ</h4>
                  <p className="text-[10px] text-slate-400 mt-0.5">Dữ liệu của bạn chưa được đưa lên mây. Nhấp đăng nhập để sao lưu tức thời.</p>
                </div>
              </div>
              <button 
                onClick={handleGoogleSignIn}
                className="shrink-0 p-1.5 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-[10px] transition cursor-pointer"
              >
                Đăng nhập ngay
              </button>
            </div>
          )}

          {/* Card: Voice / Text Entry input portal */}
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-6 shadow-xl backdrop-blur-md space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-emerald-400 animate-pulse" />
                Nhập Liệu Bằng Giọng Nói & Văn Bản
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">Nhấn giữ mic ghi âm hoặc gõ tự nhiên để Gemini AI tự động phân tích</p>
            </div>

            {/* Input Form layout */}
            <div className="space-y-3">
              <div className="relative">
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="VD: Ăn bát phở hết 50k sương sương..."
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
                    className="text-[10px] uppercase font-bold tracking-wider text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
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
                        className="w-full text-left text-xs p-1.5 px-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition truncate font-mono"
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

    </div>
  );
}
