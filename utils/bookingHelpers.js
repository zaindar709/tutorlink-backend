/**
 * Parses "2:00 PM", "2:00 pm", or "14:00" into minutes from midnight.
 * Returns null if the format is unrecognised.
 */
function parseTimeToMinutes(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return null;

    const trimmed = timeStr.trim();

    const match12 = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (match12) {
        let hours = parseInt(match12[1], 10);
        const minutes = parseInt(match12[2], 10);
        const period = match12[3].toUpperCase();
        if (period === 'PM' && hours !== 12) hours += 12;
        if (period === 'AM' && hours === 12) hours = 0;
        return hours * 60 + minutes;
    }

    const match24 = trimmed.match(/^(\d{1,2}):(\d{2})$/);
    if (match24) {
        return parseInt(match24[1], 10) * 60 + parseInt(match24[2], 10);
    }

    return null;
}

/**
 * Normalises a YYYY-MM-DD string (or Date) to UTC midnight for that calendar day.
 */
function parseBookingDate(dateInput) {
    if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
        const [year, month, day] = dateInput.split('-').map(Number);
        return new Date(Date.UTC(year, month - 1, day));
    }
    const d = new Date(dateInput);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function getDayRange(dateString) {
    const dayStart = parseBookingDate(dateString);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
    return { dayStart, dayEnd };
}

function getSessionDateTime(date, timeStr) {
    const minutes = parseTimeToMinutes(timeStr);
    if (minutes === null) return null;

    const d = new Date(date);
    return new Date(
        Date.UTC(
            d.getUTCFullYear(),
            d.getUTCMonth(),
            d.getUTCDate(),
            Math.floor(minutes / 60),
            minutes % 60
        )
    );
}

function intervalsOverlap(startA, endA, startB, endB) {
    return startA < endB && startB < endA;
}

function sortByStartTime(bookings) {
    return [...bookings].sort((a, b) => {
        const aMin = parseTimeToMinutes(a.startTime) ?? 0;
        const bMin = parseTimeToMinutes(b.startTime) ?? 0;
        return aMin - bMin;
    });
}

/**
 * Calculates session cost from snapshot rate and duration.
 * Returns a whole-number PKR amount (minimum 1).
 */
function calculateSessionAmount(hourlyRateAtBooking, startTime, endTime) {
    const startMinutes = parseTimeToMinutes(startTime);
    const endMinutes = parseTimeToMinutes(endTime);

    if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
        return null;
    }

    const durationHours = (endMinutes - startMinutes) / 60;
    const amount = Math.round(Number(hourlyRateAtBooking) * durationHours);

    return Math.max(1, amount);
}

module.exports = {
    parseTimeToMinutes,
    parseBookingDate,
    getDayRange,
    getSessionDateTime,
    intervalsOverlap,
    sortByStartTime,
    calculateSessionAmount
};
