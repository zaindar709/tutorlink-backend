/**
 * Static settings menu matching Figma Profile screen order.
 */
const SETTINGS_MENU = [
    {
        id: 'interests',
        title: 'My Interests',
        subtitle: 'Subjects and topics',
        route: '/profile/interests'
    },
    {
        id: 'certificates',
        title: 'Certificates',
        subtitle: 'Your achievements',
        route: '/profile/certificates'
    },
    {
        id: 'session-history',
        title: 'Session History',
        subtitle: 'Past learning sessions',
        route: '/profile/session-history'
    },
    {
        id: 'notifications',
        title: 'Notifications',
        subtitle: 'Manage alerts',
        route: '/profile/preferences/notifications'
    },
    {
        id: 'privacy',
        title: 'Privacy & Security',
        subtitle: 'Account protection',
        route: '/profile/preferences/privacy'
    },
    {
        id: 'app-settings',
        title: 'App Settings',
        subtitle: 'Preferences',
        route: '/profile/preferences/app'
    },
    {
        id: 'help',
        title: 'Help & Support',
        subtitle: 'Get assistance',
        route: '/profile/static/help'
    },
    {
        id: 'terms',
        title: 'Terms & Policies',
        subtitle: 'Legal information',
        route: '/profile/static/terms'
    }
];

function formatDisplayGrade(grade) {
    if (!grade) return '';
    const trimmed = grade.trim();
    if (/^class\s/i.test(trimmed)) return trimmed;
    return `Class ${trimmed}`;
}

function formatDisplayStudentId(publicId) {
    return publicId || '';
}

module.exports = {
    SETTINGS_MENU,
    formatDisplayGrade,
    formatDisplayStudentId
};
