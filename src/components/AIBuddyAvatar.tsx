import React from "react";
import { motion } from "motion/react";
import { MessageSquareReply, AlertTriangle, Coins } from "lucide-react";

interface Props {
  reply: string;
  isBroke: boolean;
  isWealthy: boolean;
  isLoading: boolean;
  error?: string | null;
}

export default function AIBuddyAvatar({ reply, isBroke, isWealthy, isLoading, error }: Props) {
  // Let the assistant's avatar alter states dynamically
  const getAvatarFaceAndColor = () => {
    if (isLoading) {
      return {
        emoji: "🧠", 
        textColor: "text-blue-400 bg-blue-500/10 border-blue-500/20",
        label: "Gemini đang dịch thuật...",
        bgPulse: "animate-pulse"
      };
    }
    if (error) {
      return {
        emoji: "🤯",
        textColor: "text-red-400 bg-red-500/10 border-red-500/20",
        label: "AI bị chấn thương tâm lý",
        bgPulse: ""
      };
    }
    if (isBroke) {
      return {
        emoji: "💀", // Broke / skull
        textColor: "text-yellow-500 bg-yellow-500/10 border-yellow-500/20",
        label: "AI đang trầm cảm giống ví bạn",
        bgPulse: ""
      };
    }
    if (isWealthy) {
      return {
        emoji: "😎", // Rich / sunglasses
        textColor: "text-emerald-400 bg-emerald-500/10 border-emerald-400/20",
        label: "AI đang nhìn bạn nịnh nọt",
        bgPulse: ""
      };
    }
    return {
      emoji: "🤖", // Neutral / cute robot
      textColor: "text-indigo-400 bg-indigo-500/10 border-indigo-500/20",
      label: "AI Buddy của bạn",
      bgPulse: ""
    };
  };

  const status = getAvatarFaceAndColor();

  return (
    <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-5 shadow-inner backdrop-blur-md">
      <div className="flex items-center gap-4">
        {/* Animated Avatar Mascot wrapper */}
        <div className="relative">
          <motion.div
            animate={isLoading ? { rotate: [0, 10, -10, 0], scale: [1, 1.1, 0.9, 1] } : {}}
            transition={{ repeat: Infinity, duration: 1.5 }}
            className={`w-14 h-14 rounded-2xl flex items-center justify-center text-3xl select-none ${status.textColor} border ${status.bgPulse} bg-slate-950 shadow-md`}
          >
            {status.emoji}
          </motion.div>
          {!isLoading && !error && (
            <span className="absolute -bottom-1.5 -right-1.5 flex h-3.5 w-3.5">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isBroke ? "bg-yellow-400" : isWealthy ? "bg-emerald-400" : "bg-indigo-400"}`}></span>
              <span className={`relative inline-flex rounded-full h-3.5 w-3.5 ${isBroke ? "bg-yellow-500" : isWealthy ? "bg-emerald-500" : "bg-indigo-500"}`}></span>
            </span>
          )}
        </div>

        {/* Mascot descriptions */}
        <div className="flex-1">
          <div className="text-[10px] uppercase font-bold tracking-widest text-slate-500">
            {status.label}
          </div>
          <h4 className="text-sm font-bold text-slate-100 flex items-center gap-1.5 mt-0.5">
            Bét-Phờ-Ren Tài Chính
          </h4>
        </div>
      </div>

      {/* Bubble Chat Area */}
      <div className="relative mt-4 p-3.5 bg-slate-950/80 rounded-xl border border-slate-800/80 text-xs text-slate-200">
        <div className="absolute top-3 left-3 text-slate-600">
          <MessageSquareReply className="w-3.5 h-3.5 opacity-30" />
        </div>
        
        <div className="pl-5 leading-relaxed italic">
          {isLoading ? (
            <div className="flex gap-1.5 py-1">
              <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce"></div>
              <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce delay-150"></div>
              <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce delay-300"></div>
            </div>
          ) : error ? (
            <p className="text-red-400 font-medium">{error}</p>
          ) : reply ? (
            <span>"{reply}"</span>
          ) : (
            <span className="text-slate-500">
              Chưa nhập gì à? Nói "Hôm nay trà sữa hết 60k sương sương" đi để trẫm phân tích và cà khịa cho nghe! 🧋
            </span>
          )}
        </div>
      </div>

      {/* Financial Health status badges in context or warnings */}
      {isBroke && !isLoading && !error && (
        <div className="mt-3 flex items-center gap-2 p-2 px-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-[11px] text-yellow-400/90 font-medium">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>Lưu ý: Bạn đang chi quá 80% hạn mức tháng. Hãy thắt lưng buộc bụng!</span>
        </div>
      )}
      
      {isWealthy && !isLoading && !error && (
        <div className="mt-3 flex items-center gap-2 p-2 px-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-400 font-medium">
          <Coins className="w-3.5 h-3.5 shrink-0" />
          <span>Wow: Số dư rủng rỉnh! Sinh hoạt phí đang dưới 30% ngân sách. Hảo gia thế!</span>
        </div>
      )}
    </div>
  );
}
