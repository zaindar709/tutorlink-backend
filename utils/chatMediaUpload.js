const path = require('path');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');

/**
 * Production chat media uploads via Cloudinary.
 * Multer keeps the file in memory → Cloudinary upload runs before the controller.
 * Exports stay compatible with existing routes/controllers.
 */

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const ALLOWED_MIME_TYPES = new Set([
    // Images
    'image/jpeg',
    'image/png',
    'image/webp',
    // Documents / homework
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    // Voice notes
    'audio/mpeg',
    'audio/ogg',
    'audio/wav',
    'audio/m4a',
    'audio/mp4'
]);

const ALLOWED_EXTENSIONS = new Set([
    '.jpg',
    '.jpeg',
    '.png',
    '.webp',
    '.pdf',
    '.doc',
    '.docx',
    '.mp3',
    '.ogg',
    '.wav',
    '.m4a',
    '.mp4'
]);

let cloudinaryConfigured = false;

function ensureCloudinaryConfig() {
    if (cloudinaryConfigured) return;

    const cloud_name = process.env.CLOUDINARY_CLOUD_NAME;
    const api_key = process.env.CLOUDINARY_API_KEY;
    const api_secret = process.env.CLOUDINARY_API_SECRET;

    if (!cloud_name || !api_key || !api_secret) {
        throw new Error(
            'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET'
        );
    }

    cloudinary.config({
        cloud_name,
        api_key,
        api_secret,
        secure: true
    });

    cloudinaryConfigured = true;
}

function resolveExtension(file) {
    return path.extname(file.originalname || '').toLowerCase();
}

function fileFilter(req, file, cb) {
    const ext = resolveExtension(file);

    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
        return cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }

    if (!ALLOWED_EXTENSIONS.has(ext)) {
        return cb(new Error(`Unsupported file extension: ${ext || '(none)'}`));
    }

    return cb(null, true);
}

function resolveCloudinaryResourceType(mimeType) {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('audio/')) return 'video'; // Cloudinary stores audio under video
    return 'raw';
}

function buildImageThumbnailUrl(publicId) {
    return cloudinary.url(publicId, {
        secure: true,
        transformation: [
            { width: 300, height: 300, crop: 'fill', quality: 'auto', fetch_format: 'auto' }
        ]
    });
}

function uploadBufferToCloudinary(file, conversationId) {
    ensureCloudinaryConfig();

    const resourceType = resolveCloudinaryResourceType(file.mimetype);
    const folder = `tutorlink/chat-media/${conversationId || 'misc'}`;

    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder,
                resource_type: resourceType,
                use_filename: true,
                unique_filename: true,
                overwrite: false,
                type: 'upload'
            },
            (error, result) => {
                if (error) {
                    return reject(error);
                }
                return resolve(result);
            }
        );

        uploadStream.end(file.buffer);
    });
}

const memoryUpload = multer({
    storage: multer.memoryStorage(),
    fileFilter,
    limits: {
        fileSize: MAX_FILE_SIZE,
        files: 1
    }
}).single('file');

/**
 * Multer-compatible middleware:
 * 1) Validate MIME + extension + size
 * 2) Upload buffer to Cloudinary
 * 3) Attach result on req.file for buildMediaPayload()
 */
function chatMediaUpload(req, res, cb) {
    memoryUpload(req, res, async (error) => {
        if (error) {
            return cb(error);
        }

        if (!req.file) {
            return cb(null);
        }

        try {
            const result = await uploadBufferToCloudinary(req.file, req.params.conversationId);

            const isImage = req.file.mimetype.startsWith('image/');
            const secureUrl = result.secure_url;

            req.file.cloudinary = {
                public_id: result.public_id,
                resource_type: result.resource_type,
                secure_url: secureUrl,
                thumbnail_url: isImage ? buildImageThumbnailUrl(result.public_id) : secureUrl,
                bytes: result.bytes,
                duration: typeof result.duration === 'number' ? result.duration : null,
                format: result.format
            };

            return cb(null);
        } catch (uploadError) {
            console.error('Cloudinary chat media upload failed:', uploadError.message || uploadError);
            return cb(
                uploadError instanceof Error
                    ? uploadError
                    : new Error('Failed to upload media to Cloudinary')
            );
        }
    });
}

/**
 * Build Message.media payload from Cloudinary-backed multer file.
 * Empty payload when file is null (delete / text-only paths).
 */
function buildMediaPayload(file, options = {}) {
    if (!file) {
        return {
            url: '',
            thumbnail: '',
            fileName: '',
            fileSize: 0,
            mimeType: '',
            duration: null
        };
    }

    const cloud = file.cloudinary;
    if (!cloud?.secure_url) {
        throw new Error('Cloudinary upload result missing on file');
    }

    const isVoice = typeof file.mimetype === 'string' && file.mimetype.startsWith('audio/');
    const clientDuration = Number(options.duration);
    const duration = isVoice
        ? (Number.isFinite(clientDuration) && clientDuration > 0
            ? clientDuration
            : cloud.duration)
        : null;

    return {
        url: cloud.secure_url,
        thumbnail: cloud.thumbnail_url || cloud.secure_url,
        fileName: file.originalname || options.fileName || '',
        fileSize: cloud.bytes || file.size || 0,
        mimeType: file.mimetype || '',
        duration
    };
}

/**
 * Best-effort cleanup if controller aborts after a successful Cloudinary upload.
 */
async function cleanupChatMediaFile(file) {
    if (!file?.cloudinary?.public_id) return;

    try {
        ensureCloudinaryConfig();
        await cloudinary.uploader.destroy(file.cloudinary.public_id, {
            resource_type: file.cloudinary.resource_type || 'auto'
        });
    } catch (error) {
        console.error('Cloudinary chat media cleanup failed:', error.message);
    }
}

module.exports = {
    chatMediaUpload,
    buildMediaPayload,
    cleanupChatMediaFile,
    ALLOWED_MIME_TYPES,
    ALLOWED_EXTENSIONS,
    MAX_FILE_SIZE
};
