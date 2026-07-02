const fs = require('fs');
const path = require('path');
const multer = require('multer');

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const CNIC_MIME_TYPES = new Set(['image/jpeg', 'image/png']);
const DEGREE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf']);

const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads', 'tutor-documents');

const MIME_EXTENSION_MAP = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'application/pdf': '.pdf'
};

function ensureUploadDir(userId) {
    const dir = path.join(UPLOAD_ROOT, userId.toString());
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function resolveExtension(file) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext) return ext;
    return MIME_EXTENSION_MAP[file.mimetype] || '';
}

function buildFilename(fieldname, file) {
    const prefixMap = {
        cnicFront: 'cnic-front',
        cnicBack: 'cnic-back',
        degree: 'degree'
    };
    const prefix = prefixMap[fieldname];
    return `${prefix}-${Date.now()}${resolveExtension(file)}`;
}

function fileFilter(req, file, cb) {
    if (file.fieldname === 'cnicFront' || file.fieldname === 'cnicBack') {
        if (!CNIC_MIME_TYPES.has(file.mimetype)) {
            return cb(new Error('CNIC files must be JPG or PNG images'));
        }
        return cb(null, true);
    }

    if (file.fieldname === 'degree') {
        if (!DEGREE_MIME_TYPES.has(file.mimetype)) {
            return cb(new Error('Degree certificate must be JPG, PNG, or PDF'));
        }
        return cb(null, true);
    }

    return cb(new Error(`Unexpected upload field: ${file.fieldname}`));
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        try {
            const dir = ensureUploadDir(req.user._id);
            cb(null, dir);
        } catch (error) {
            cb(error);
        }
    },
    filename: (req, file, cb) => {
        cb(null, buildFilename(file.fieldname, file));
    }
});

const tutorDocumentUpload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: MAX_FILE_SIZE,
        files: 3
    }
}).fields([
    { name: 'cnicFront', maxCount: 1 },
    { name: 'cnicBack', maxCount: 1 },
    { name: 'degree', maxCount: 1 }
]);

function buildPublicDocumentPath(userId, filename) {
    return `/uploads/tutor-documents/${userId}/${filename}`;
}

function deleteLocalDocument(urlPath) {
    if (!urlPath || !urlPath.startsWith('/uploads/tutor-documents/')) return;

    const absolutePath = path.join(__dirname, '..', urlPath.replace(/^\//, ''));
    if (!fs.existsSync(absolutePath)) return;

    fs.unlinkSync(absolutePath);
}

function cleanupUploadedFiles(files) {
    if (!files) return;

    Object.values(files).forEach((fileGroup) => {
        fileGroup.forEach((file) => {
            if (file.path && fs.existsSync(file.path)) {
                fs.unlinkSync(file.path);
            }
        });
    });
}

module.exports = {
    tutorDocumentUpload,
    buildPublicDocumentPath,
    deleteLocalDocument,
    cleanupUploadedFiles,
    UPLOAD_ROOT
};
