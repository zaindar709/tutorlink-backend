const express = require('express');
const router = express.Router();

const authMiddleware = require('../middleware/authMiddleware');
const { requireAdmin } = require('../middleware/adminMiddleware');
const adminController = require('../controllers/adminController');

router.use(authMiddleware);
router.use(requireAdmin);

router.get('/tutors/pending', adminController.getPendingTutors);
router.patch('/tutors/:tutorProfileId/verify', adminController.verifyTutor);
router.patch('/tutors/:tutorProfileId/interview', adminController.scheduleInterview);
router.patch('/tutors/:tutorProfileId/reject', adminController.rejectTutor);

router.get('/dashboard/stats', adminController.getDashboardStats);
router.get('/billing/escrow', adminController.getEscrowBilling);
router.patch('/billing/disputes/:transactionId/resolve', adminController.resolveBillingDispute);

router.get('/links', adminController.getParentStudentLinks);
router.delete('/links/:linkId/revoke', adminController.revokeParentStudentLink);

module.exports = router;
