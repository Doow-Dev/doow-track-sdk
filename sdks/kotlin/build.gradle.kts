import java.util.Base64

plugins {
    kotlin("jvm") version "1.9.20"
    kotlin("plugin.serialization") version "1.9.20"
    `java-library`
    `maven-publish`
    signing
    id("tech.yanand.maven-central-publish") version "1.3.0"
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

// Maven Central requires sources and javadoc jars alongside the main artifact.
java {
    withSourcesJar()
    withJavadocJar()
}

publishing {
    publications {
        create<MavenPublication>("mavenJava") {
            from(components["java"])
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
    }
}

// Signing is skipped when no key is present so a plain `gradle build` still works on a machine
// without the release key. CI always supplies one.
val signingKey: String? = System.getenv("MAVEN_SIGNING_KEY")
signing {
    if (!signingKey.isNullOrBlank()) {
        useInMemoryPgpKeys(signingKey, System.getenv("MAVEN_SIGNING_PASSWORD"))
        sign(publishing.publications["mavenJava"])
    }
}

// The Central Portal Publisher API takes a Base64-encoded "username:password" pair, where the
// credentials are a Portal user token rather than an account login.
mavenCentral {
    val user = System.getenv("MAVEN_USERNAME").orEmpty()
    val password = System.getenv("MAVEN_PASSWORD").orEmpty()
    authToken = Base64.getEncoder().encodeToString("$user:$password".toByteArray())
    publishingType = "AUTOMATIC"
    maxWait = 600
}
