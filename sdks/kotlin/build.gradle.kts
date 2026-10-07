plugins {
    kotlin("jvm") version "1.9.20"
    kotlin("plugin.serialization") version "1.9.20"
    `java-library`
    id("com.vanniktech.maven.publish") version "0.30.0"
}

group = "co.doow"
version = "0.1.1"

repositories {
    mavenCentral()
}

dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.7.3")
    implementation("io.ktor:ktor-client-core:2.3.5")
    implementation("io.ktor:ktor-client-cio:2.3.5")
    implementation("io.ktor:ktor-client-content-negotiation:2.3.5")
    implementation("io.ktor:ktor-serialization-kotlinx-json:2.3.5")

    testImplementation(kotlin("test"))
}

tasks.test {
    useJUnitPlatform()
}

kotlin {
    jvmToolchain(17)
}

// Publishes to the Sonatype Central Portal. The plugin supplies the sources and javadoc jars that
// Central requires, and signs every artifact. Credentials and the signing key arrive as
// ORG_GRADLE_PROJECT_* environment variables from CI; without them the configuration still
// resolves so that a plain `gradle build` works on a developer machine.
mavenPublishing {
    publishToMavenCentral()
    signAllPublications()

    coordinates("co.doow", "doow-track-kotlin", version.toString())

    pom {
        name.set("Doow Track Kotlin SDK")
        description.set("Official Kotlin SDK for Doow usage telemetry and management")
        url.set("https://github.com/Doow-Dev/doow-track-sdk")
        licenses {
            license {
                name.set("MIT License")
                url.set("https://opensource.org/licenses/MIT")
            }
        }
        developers {
            developer {
                id.set("doow")
                name.set("Doow")
                url.set("https://github.com/Doow-Dev")
            }
        }
        scm {
            url.set("https://github.com/Doow-Dev/doow-track-sdk")
            connection.set("scm:git:git://github.com/Doow-Dev/doow-track-sdk.git")
            developerConnection.set("scm:git:ssh://git@github.com/Doow-Dev/doow-track-sdk.git")
        }
    }
}
