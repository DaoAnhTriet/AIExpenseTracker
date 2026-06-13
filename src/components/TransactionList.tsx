import React, { useState } from "react";
import { Search, Calendar, ChevronDown, Trash2, ArrowUpRight, ArrowDownRight, RefreshCw, Layers } from "lucide-react";
import { Transaction } from "../types";

interface Props {
  transactions: Transaction[];
  onDeleteTransaction: (id: string) => void;
}

const CATEGORY_COLORS: { [key: string]: { bg: string, text: string } } = {
  "Ăn uống": { bg: "bg-orange-500/10", text: "text-orange-400" },
  "Di chuyển": { bg: "bg-blue-500/10", text: "text-blue-400" },
  "Mua sắm": { bg: "bg-pink-500/10", text: "text-pink-400" },
  "Nhà ở & Hóa đơn": { bg: "bg-red-500/10", text: "text-red-400" },
  "Học tập": { bg: "bg-yellow-500/10", text: "text-yellow-400" },
  "Giải trí": { bg: "bg-purple-500/10", text: "text-purple-400" },
  "Sức khỏe": { bg: "bg-teal-500/10", text: "text-teal-400" },
  "Thu nhập": { bg: "bg-emerald-500/10", text: "text-emerald-400" },
  "Khác": { bg: "bg-slate-500/10", text: "text-slate-400" }
};

export default function TransactionList({ transactions, onDeleteTransaction }: Props) {
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const formatVnd = (num: number) => {
    return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(num);
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("vi-VN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  const getCategoryStyles = (cat: string) => {
    return CATEGORY_COLORS[cat] || { bg: "bg-slate-500/10", text: "text-slate-400" };
  };

  const handleDelete = (id: string, note: string) => {
    const confirmed = window.confirm(`Bạn có chắc muốn xóa vĩnh viễn giao dịch "${note}" này? Hành động này không thể hoàn tác.`);
    if (confirmed) {
      onDeleteTransaction(id);
    }
  };

  // Filter transactions
  const filteredTransactions = transactions.filter((tx) => {
    const matchesSearch = 
      tx.note.toLowerCase().includes(searchTerm.toLowerCase()) || 
      tx.category.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesCategory = categoryFilter === "all" || tx.category === categoryFilter;

    return matchesSearch && matchesCategory;
  });

  return (
    <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-5 shadow-lg backdrop-blur-md flex flex-col">
      {/* Search Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div>
          <h4 className="text-sm font-bold text-slate-100 flex items-center gap-1.5">
            Lịch Sử Giao Dịch
            <span className="text-xs font-normal text-slate-500">({transactions.length} bản ghi)</span>
          </h4>
          <p className="text-[11px] text-slate-400">Xem chi tiết các dòng tiền đã kiểm tra</p>
        </div>

        {/* Filter selects */}
        <div className="flex gap-2">
          <div className="relative flex-1 sm:flex-initial">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="text-xs pl-3 pr-7 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-300 focus:outline-none appearance-none"
            >
              <option value="all">Tất cả mục</option>
              {Object.keys(CATEGORY_COLORS).map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute top-2.5 right-2 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Inputs searching */}
      <div className="relative mb-4">
        <input
          type="text"
          placeholder="Tìm kiếm giao dịch (VD: Trà sữa, Ăn uống...)"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full text-xs pl-9 pr-3.5 py-3 bg-slate-950 border border-slate-800/80 rounded-xl text-white focus:outline-none focus:border-indigo-400 placeholder:text-slate-600 font-medium"
        />
        <Search className="w-4 h-4 text-slate-600 absolute top-3.5 left-3" />
      </div>

      {/* Details Table scrollarea */}
      <div className="flex-1 overflow-y-auto max-h-[320px] pr-1 space-y-2.5 custom-scrollbar">
        {filteredTransactions.length === 0 ? (
          <div className="py-12 text-center bg-slate-950/20 rounded-xl border border-dashed border-slate-800 flex flex-col items-center justify-center">
            <Layers className="w-8 h-8 text-slate-700 mb-2" />
            <p className="text-xs text-slate-500">Chưa tìm thấy lịch sử chi tiêu phù hợp.</p>
          </div>
        ) : (
          filteredTransactions.map((tx) => {
            const styles = getCategoryStyles(tx.category);
            const isExpense = tx.type === "expense";

            return (
              <div
                key={tx.id}
                className="p-3 bg-slate-950/40 rounded-xl border border-slate-800/40 hover:border-slate-700/60 transition-all flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  {/* Expense/Income icon */}
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border border-slate-800/40 ${isExpense ? "bg-rose-500/10 text-rose-400" : "bg-emerald-500/10 text-emerald-400"}`}>
                    {isExpense ? <ArrowDownRight className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                  </div>

                  <div>
                    <h5 className="text-xs font-bold text-slate-200">{tx.note}</h5>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${styles.bg} ${styles.text}`}>
                        {tx.category}
                      </span>
                      <span className="text-[10px] text-slate-500 flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {formatDate(tx.date)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className={`text-xs font-extrabold ${isExpense ? "text-slate-100" : "text-emerald-400"}`}>
                    {isExpense ? "-" : "+"} {formatVnd(tx.amount)}
                  </span>

                  <button
                    onClick={() => handleDelete(tx.id, tx.note)}
                    className="p-1 px-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 md:opacity-0 group-hover:opacity-100 transition-all duration-200 cursor-pointer"
                    title="Xóa giao dịch"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
