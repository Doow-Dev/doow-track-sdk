package co.doow.track

class DoowError(
    override val message: String,
    val statusCode: Int = 0,
    val errorClass: String? = null
) : RuntimeException(message) {
    val isNotFound: Boolean get() = statusCode == 404
    val isUnauthorized: Boolean get() = statusCode == 401
    val isForbidden: Boolean get() = statusCode == 403
    val isRateLimited: Boolean get() = statusCode == 429
    val isServerError: Boolean get() = statusCode >= 500
}
