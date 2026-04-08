/**
 * Error Handler Middleware
 * 
 * Centralizes error handling for consistent API responses.
 */

/**
 * Custom API Error class
 */
export class ApiError extends Error {
  constructor(statusCode, message, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.name = 'ApiError';
  }
}

/**
 * Not Found handler (404)
 */
export function notFoundHandler(req, res, next) {
  next(new ApiError(404, `Route not found: ${req.method} ${req.path}`));
}

/**
 * Global error handler
 */
export function errorHandler(err, req, res, next) {
  // Log error in development
  if (process.env.NODE_ENV === 'development') {
    console.error('Error:', err);
  }

  // Handle known API errors
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      error: err.message,
      ...(err.details && { details: err.details }),
    });
  }

  // Handle Prisma errors
  if (err.code === 'P2002') {
    return res.status(409).json({
      error: 'Resource already exists',
    });
  }

  if (err.code === 'P2025') {
    return res.status(404).json({
      error: 'Resource not found',
    });
  }

  // Handle validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.message,
    });
  }

  // Default to 500 Internal Server Error
  res.status(500).json({
    error: 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { message: err.message }),
  });
}

export default { ApiError, notFoundHandler, errorHandler };
