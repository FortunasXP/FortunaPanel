// FortunaPanel - Zip Extractor
// Streams a zip buffer/file into a target directory with zip-slip protection.
const fs = require('fs');
const path = require('path');
const yauzl = require('yauzl');
const logger = require('../utils/logger');

const MAX_ENTRIES = 5000;           // sanity cap against zip bombs
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024; // 2GB uncompressed cap

// POSIX file-mode constants for the high 16 bits of externalFileAttributes.
const S_IFMT  = 0o170000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;

function isSafeEntry(targetRoot, entryPath) {
    const resolved = path.resolve(targetRoot, entryPath);
    const relative = path.relative(targetRoot, resolved);
    return !relative.startsWith('..') && !path.isAbsolute(relative);
}

// Extract POSIX file type from a yauzl entry's external attributes. Returns
// null if the zip wasn't made by a unix-y tool (no unix mode bits set).
function entryPosixType(entry) {
    // madeByVersion: high byte identifies the source OS. 3 = Unix.
    const madeBy = entry.versionMadeBy !== undefined ? (entry.versionMadeBy >>> 8) : 3;
    if (madeBy !== 3) return null;
    const mode = (entry.externalFileAttributes >>> 16) & 0xFFFF;
    if (!mode) return null;
    return mode & S_IFMT;
}

// Reject symlinks, hardlinks-via-mode, and any non-regular / non-directory
// entry (block devices, char devices, sockets, FIFOs). zip-slip protection
// already blocks absolute / traversal paths; this closes the symlink escape.
function isForbiddenSpecialEntry(entry) {
    const type = entryPosixType(entry);
    if (type === null) return false;
    if (type === S_IFLNK) return true;
    if (type === S_IFREG || type === S_IFDIR) return false;
    return true;
}

/**
 * Extract a zip buffer into destDir.
 * Returns { destDir, fileCount, totalBytes }.
 * If the zip contains a single top-level folder, extraction is flattened into destDir.
 */
function extractZipBuffer(buffer, destDir) {
    return new Promise((resolve, reject) => {
        yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
            if (err) return reject(err);

            // Pass 1: scan entries to detect a single top-level folder
            const allEntries = [];
            zipfile.on('entry', (entry) => {
                allEntries.push(entry.fileName);
                zipfile.readEntry();
            });
            zipfile.once('end', () => {
                if (allEntries.length === 0) {
                    return reject(new Error('Zip archive is empty'));
                }
                if (allEntries.length > MAX_ENTRIES) {
                    return reject(new Error(`Zip contains too many entries (> ${MAX_ENTRIES})`));
                }

                // Detect shared top-level folder: every entry starts with "<folder>/"
                let stripPrefix = '';
                const firstSlash = allEntries[0].indexOf('/');
                if (firstSlash > 0) {
                    const candidate = allEntries[0].substring(0, firstSlash + 1);
                    if (allEntries.every(name => name.startsWith(candidate) || name === candidate.slice(0, -1))) {
                        stripPrefix = candidate;
                    }
                }

                // Pass 2: actually extract
                yauzl.fromBuffer(buffer, { lazyEntries: true }, (err2, zipfile2) => {
                    if (err2) return reject(err2);

                    fs.mkdirSync(destDir, { recursive: true });
                    let fileCount = 0;
                    let totalBytes = 0;

                    const finish = (error) => {
                        try { zipfile2.close(); } catch (_) {}
                        if (error) return reject(error);
                        resolve({ destDir, fileCount, totalBytes });
                    };

                    zipfile2.readEntry();
                    zipfile2.on('entry', (entry) => {
                        // Reject symlinks and other special file types before
                        // anything else. This closes the classic "symlink
                        // escape" where a symlink points outside destDir and
                        // subsequent entries write through it.
                        if (isForbiddenSpecialEntry(entry)) {
                            return finish(new Error(`Forbidden zip entry (symlink or special file): ${entry.fileName}`));
                        }

                        let name = entry.fileName;
                        if (stripPrefix && name.startsWith(stripPrefix)) {
                            name = name.substring(stripPrefix.length);
                        }
                        if (!name) {
                            return zipfile2.readEntry();
                        }

                        // Normalize & validate path
                        const normalized = name.replace(/\\/g, '/');
                        if (!isSafeEntry(destDir, normalized)) {
                            return finish(new Error(`Unsafe zip entry path: ${entry.fileName}`));
                        }

                        const targetPath = path.join(destDir, normalized);

                        // Directory entry
                        if (/\/$/.test(entry.fileName)) {
                            try {
                                fs.mkdirSync(targetPath, { recursive: true });
                            } catch (e) {
                                return finish(e);
                            }
                            return zipfile2.readEntry();
                        }

                        // File entry — enforce cumulative size cap
                        totalBytes += entry.uncompressedSize || 0;
                        if (totalBytes > MAX_TOTAL_BYTES) {
                            return finish(new Error(`Zip too large (> ${MAX_TOTAL_BYTES} bytes uncompressed)`));
                        }

                        try {
                            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
                        } catch (e) {
                            return finish(e);
                        }

                        zipfile2.openReadStream(entry, (streamErr, readStream) => {
                            if (streamErr) return finish(streamErr);
                            const writeStream = fs.createWriteStream(targetPath);
                            readStream.on('error', finish);
                            writeStream.on('error', finish);
                            writeStream.on('close', () => {
                                fileCount++;
                                zipfile2.readEntry();
                            });
                            readStream.pipe(writeStream);
                        });
                    });

                    zipfile2.once('end', () => {
                        logger.info(`Extracted zip to ${destDir} (${fileCount} files, ${totalBytes} bytes)`);
                        finish();
                    });

                    zipfile2.once('error', finish);
                });
            });

            zipfile.once('error', reject);
            zipfile.readEntry();
        });
    });
}

module.exports = { extractZipBuffer };
