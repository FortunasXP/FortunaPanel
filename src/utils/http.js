class ApiError extends Error {
    constructor(status, message, options = {}) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.expose = options.expose !== false;
        this.details = options.details;
    }
}

function asyncRoute(handler) {
    return (req, res, next) => {
        Promise.resolve(handler(req, res, next)).catch(next);
    };
}

function badRequest(message, details) {
    return new ApiError(400, message, { details });
}

function unauthorized(message = 'Unauthorized') {
    return new ApiError(401, message);
}

function forbidden(message = 'Forbidden') {
    return new ApiError(403, message);
}

function notFound(message = 'Not found') {
    return new ApiError(404, message);
}

module.exports = {
    ApiError,
    asyncRoute,
    badRequest,
    unauthorized,
    forbidden,
    notFound
};
