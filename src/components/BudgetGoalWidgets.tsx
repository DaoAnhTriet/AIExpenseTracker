import React, { useState } from "react";
import { DollarSign, Percent, TrendingUp, Plus, Trash2, PiggyBank, Edit } from "lucide-react";
import { Goal, UserProfile } from "../types";

interface Props {
  userProfile: UserProfile;
  goals: Goal[];
  onUpdateBudget: (newBudget: number) => void;
  onAddGoal: (name: string, target: number) => void;
  onFundGoal: (id: string, amount: number) => void;
  onDeleteGoal: (id: string) => void;
  totalExpenses: number;
}

export default function BudgetGoalWidgets({
  userProfile,
  goals,
  onUpdateBudget,
  onAddGoal,
  onFundGoal,
  onDeleteGoal,
  totalExpenses
}: Props) {
  const [isEditingBudget, setIsEditingBudget] = useState(false);
  const [tempBudget, setTempBudget] = useState(userProfile.monthly_budget.toString());
  const [showAddGoal, setShowAddGoal] = useState(false);
  const [newGoalName, setNewGoalName] = useState("");
  const [newGoalTarget, setNewGoalTarget] = useState("");
  const [fundAmounts, setFundAmounts] = useState<{ [key: string]: string }>({});

  const formatVnd = (num: number) => {
    return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(num);
  };

  const handleUpdateBudgetSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseInt(tempBudget.replace(/\D/g, ""), 10);
    if (!isNaN(val) && val >= 0) {
      onUpdateBudget(val);
      setIsEditingBudget(false);
    }
  };

  const handleAddGoalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const target = parseInt(newGoalTarget.replace(/\D/g, ""), 10);
    if (newGoalName.trim() && !isNaN(target) && target > 0) {
      onAddGoal(newGoalName.trim(), target);
      setNewGoalName("");
      setNewGoalTarget("");
      setShowAddGoal(false);
    }
  };

  const handleFundGoalSubmit = (id: string) => {
    const amountStr = fundAmounts[id] || "";
    const amount = parseInt(amountStr.replace(/\D/g, ""), 10);
    if (!isNaN(amount) && amount > 0) {
      onFundGoal(id, amount);
      setFundAmounts({ ...fundAmounts, [id]: "" });
    }
  };

  const handleDeleteGoalClick = (id: string, name: string) => {
    const confirmed = window.confirm(`Bạn có chắc chắn muốn xóa mục tiêu tích lũy "${name}" này không? Số tiền đã tích lũy sẽ không bị mất khỏi ví nhưng mục tiêu sẽ bị xóa.`);
    if (confirmed) {
      onDeleteGoal(id);
    }
  };

  const expensePercent = Math.min(Math.round((totalExpenses / Math.max(1, userProfile.monthly_budget)) * 100), 100);

  return (
    <div className="space-y-6">
      {/* 1. Monthly Budget Card */}
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-5 shadow-lg backdrop-blur-md">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-slate-100">Kế Hoạch & Ngân Sách Tháng</h4>
              <p className="text-[11px] text-slate-400">Kiểm soát dòng tiền ra vào</p>
            </div>
          </div>

          {!isEditingBudget ? (
            <button
              onClick={() => {
                setTempBudget(userProfile.monthly_budget.toString());
                setIsEditingBudget(true);
              }}
              className="p-1 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 font-medium flex items-center gap-1.5 transition-colors"
            >
              <Edit className="w-3.5 h-3.5" /> Chỉnh sửa
            </button>
          ) : null}
        </div>

        {isEditingBudget ? (
          <form onSubmit={handleUpdateBudgetSubmit} className="space-y-3 mb-4">
            <div>
              <label className="block text-[11px] text-slate-400 font-medium mb-1 uppercase tracking-wider">Ngân sách chi tiêu tháng dưới dạng VND</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={tempBudget}
                  onChange={(e) => setTempBudget(e.target.value)}
                  className="flex-1 text-xs px-3.5 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-indigo-400"
                />
                <button
                  type="submit"
                  className="px-3.5 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-xs text-white font-semibold transition"
                >
                  Lưu
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingBudget(false)}
                  className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 font-semibold transition"
                >
                  Hủy
                </button>
              </div>
            </div>
          </form>
        ) : (
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="p-3 bg-slate-950/40 rounded-xl border border-slate-800/40">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Hạn mức tháng</span>
              <div className="text-sm font-extrabold text-white mt-1">{formatVnd(userProfile.monthly_budget)}</div>
            </div>
            <div className="p-3 bg-slate-950/40 rounded-xl border border-slate-800/40">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Đã tiêu tháng này</span>
              <div className={`text-sm font-extrabold mt-1 ${totalExpenses > userProfile.monthly_budget ? "text-rose-400" : "text-yellow-400"}`}>
                {formatVnd(totalExpenses)}
              </div>
            </div>
          </div>
        )}

        {/* Custom Circular / Linear progress indicator */}
        <div className="space-y-1.5 mt-2">
          <div className="flex justify-between text-xs text-slate-400 font-medium">
            <span>Mức tiêu thụ ngân sách</span>
            <span className={`${expensePercent > 80 ? "text-rose-400" : "text-slate-300"}`}>{expensePercent}%</span>
          </div>
          <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${expensePercent > 100 ? "bg-rose-500" : expensePercent > 80 ? "bg-yellow-500" : "bg-indigo-500"}`}
              style={{ width: `${expensePercent}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* 2. Savings Goals section */}
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-5 shadow-lg backdrop-blur-md">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg">
              <PiggyBank className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-slate-100">Kế Hoạch Tích Lũy</h4>
              <p className="text-[11px] text-slate-400">Kiến tạo các cột mốc tương lai</p>
            </div>
          </div>

          <button
            onClick={() => setShowAddGoal(!showAddGoal)}
            className="p-1 px-3.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-xs text-emerald-400 font-semibold flex items-center gap-1 transition"
          >
            <Plus className="w-3.5 h-3.5" /> Tạo mục tiêu
          </button>
        </div>

        {/* Add goal subform */}
        {showAddGoal && (
          <form onSubmit={handleAddGoalSubmit} className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/80 space-y-3 mb-4">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Tên mục tiêu</label>
                <input
                  type="text"
                  placeholder="VD: Mua iPhone 16"
                  value={newGoalName}
                  onChange={(e) => setNewGoalName(e.target.value)}
                  className="w-full text-xs px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder:text-slate-600 focus:outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Số tiền cần (VND)</label>
                <input
                  type="text"
                  placeholder="VD: 30000000"
                  value={newGoalTarget}
                  onChange={(e) => setNewGoalTarget(e.target.value)}
                  className="w-full text-xs px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder:text-slate-600 focus:outline-none"
                  required
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowAddGoal(false)}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 transition"
              >
                Hủy
              </button>
              <button
                type="submit"
                className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-xs text-white font-semibold transition"
              >
                Thêm mục tiêu
              </button>
            </div>
          </form>
        )}

        {/* Goals lists */}
        {goals.length === 0 ? (
          <div className="py-6 text-center bg-slate-950/20 rounded-xl border border-dashed border-slate-800">
            <p className="text-xs text-slate-500">Chưa có mục tiêu tích lũy nào được thiết lập.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {goals.map((goal) => {
              const currentPercent = Math.min(Math.round((goal.current / goal.target) * 100), 100);
              return (
                <div key={goal.id} className="p-3.5 bg-slate-950/40 rounded-xl border border-slate-800/40 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <h5 className="text-xs font-bold text-slate-200">{goal.name}</h5>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        {formatVnd(goal.current)} / <span className="text-slate-500">{formatVnd(goal.target)}</span>
                      </p>
                    </div>

                    <button
                      onClick={() => handleDeleteGoalClick(goal.id, goal.name)}
                      className="p-1 px-1.5 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition"
                      title="Xóa mục tiêu"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Progressive Bar */}
                  <div className="space-y-1">
                    <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-500"
                        style={{ width: `${currentPercent}%` }}
                      ></div>
                    </div>
                    <div className="flex justify-between items-center text-[10px] text-slate-500 font-medium pt-1">
                      <span>Đạt {currentPercent}%</span>
                      {currentPercent === 100 ? (
                        <span className="text-emerald-400 font-bold uppercase tracking-wider">🎉 Đã hoàn tất!</span>
                      ) : null}
                    </div>
                  </div>

                  {/* Fund adding form */}
                  {currentPercent < 100 && (
                    <div className="flex items-center gap-1.5 pt-1 border-t border-slate-900/60 mt-2">
                      <input
                        type="text"
                        placeholder="Thêm VND tích lũy..."
                        value={fundAmounts[goal.id] || ""}
                        onChange={(e) => setFundAmounts({ ...fundAmounts, [goal.id]: e.target.value })}
                        className="flex-1 text-[11px] px-2.5 py-1 bg-slate-900 border border-slate-800 rounded-lg text-white focus:outline-none focus:border-emerald-500 placeholder:text-slate-600"
                      />
                      <button
                        type="button"
                        onClick={() => handleFundGoalSubmit(goal.id)}
                        className="px-2.5 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-[10px] text-white font-bold transition flex items-center gap-1"
                      >
                        Tích lũy
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
