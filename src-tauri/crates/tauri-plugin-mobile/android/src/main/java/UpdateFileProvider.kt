package com.twac.kuriume.mobile

import androidx.core.content.FileProvider

/**
 * Shares downloaded update packages with the system installer
 * (res/xml/kuriume_update_paths.xml). A class of its own so it never clashes
 * with another FileProvider in the merged app manifest.
 */
class UpdateFileProvider : FileProvider()
