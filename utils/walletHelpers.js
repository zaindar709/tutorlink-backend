/**
 * Formats a numeric amount for Figma wallet cards: "Rs. 5,000"
 */
function formatCurrency(amount) {
    const value = Math.max(0, Number(amount) || 0);
    return `Rs. ${value.toLocaleString('en-PK', { maximumFractionDigits: 0 })}`;
}

/**
 * Formats transaction row amount: "+Rs. 3,000" | "-Rs. 1,500"
 */
function formatTransactionAmount(amount, direction) {
    const prefix = direction === 'credit' ? '+' : '-';
    const value = Number(amount) || 0;
    return `${prefix}Rs. ${value.toLocaleString('en-PK', { maximumFractionDigits: 0 })}`;
}

/**
 * Formats transaction timestamp for Figma list: "Today • 2:30 PM"
 */
function formatTransactionTimestamp(date) {
    const d = new Date(date);
    const now = new Date();

    const timeStr = d.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });

    const isSameDay = (a, b) =>
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate();

    if (isSameDay(d, now)) {
        return `Today • ${timeStr}`;
    }

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    if (isSameDay(d, yesterday)) {
        return `Yesterday • ${timeStr}`;
    }

    const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${dateStr} • ${timeStr}`;
}

function formatPaymentMethodLabel(paymentMethod) {
    if (paymentMethod === 'jazzcash') return 'JazzCash';
    if (paymentMethod === 'easypaisa') return 'EasyPaisa';
    if (paymentMethod === 'internal_transfer') return 'Internal Transfer';
    return null;
}

module.exports = {
    formatCurrency,
    formatTransactionAmount,
    formatTransactionTimestamp,
    formatPaymentMethodLabel
};
