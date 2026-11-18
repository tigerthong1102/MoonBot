// swift-tools-version: 5.9
// Modified for StartupBot; original copyright and license retained.
import PackageDescription

let package = Package(
    name: "CompanionCore",
    platforms: [.iOS(.v17), .macOS(.v13)],
    products: [
        .library(name: "CompanionCore", targets: ["CompanionCore"])
    ],
    targets: [
        .target(name: "CompanionCore"),
        .testTarget(
            name: "CompanionCoreTests",
            dependencies: ["CompanionCore"],
            resources: [.copy("Fixtures")]
        ),
    ]
)
