# drashti-translate on Windows (alpha.22): scripts/fetch-translate.mjs runs this with the checked sources it unpacked.
# CTranslate2 4.9.1 for the CPU only (ruy for int8 and float matrix products; no MKL, no OpenMP, no GPU) and
# SentencePiece 0.2.1 with its own protobuf-lite and absl; everything static, the C++ runtime linked in (/MT), so the
# program needs no DLL beside it.
# 3.25: add_subdirectory's SYSTEM, so the libraries' headers are external to the helper (MSVC's /external:I).
cmake_minimum_required(VERSION 3.25)
project(drashti_translate C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded" CACHE STRING "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)

# CTranslate2: CPU, ruy only.
set(WITH_MKL OFF CACHE BOOL "" FORCE)
set(WITH_DNNL OFF CACHE BOOL "" FORCE)
set(WITH_OPENBLAS OFF CACHE BOOL "" FORCE)
set(WITH_RUY ON CACHE BOOL "" FORCE)
set(WITH_CUDA OFF CACHE BOOL "" FORCE)
set(OPENMP_RUNTIME "NONE" CACHE STRING "" FORCE)
set(BUILD_CLI OFF CACHE BOOL "" FORCE)
set(BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(ENABLE_CPU_DISPATCH ON CACHE BOOL "" FORCE)
add_subdirectory(${CT2_SOURCE} ctranslate2 EXCLUDE_FROM_ALL SYSTEM)

# SentencePiece: its own protobuf-lite and absl, static, /MT, no tcmalloc.
set(SPM_ENABLE_SHARED OFF CACHE BOOL "" FORCE)
set(SPM_ENABLE_TCMALLOC OFF CACHE BOOL "" FORCE)
set(SPM_ENABLE_MSVC_MT_BUILD ON CACHE BOOL "" FORCE)
set(SPM_PROTOBUF_PROVIDER "internal" CACHE STRING "" FORCE)
set(SPM_ABSL_PROVIDER "internal" CACHE STRING "" FORCE)
add_subdirectory(${SPM_SOURCE} sentencepiece EXCLUDE_FROM_ALL SYSTEM)

add_executable(drashti-translate ${HELPER_SOURCE})
target_link_libraries(drashti-translate PRIVATE ctranslate2 sentencepiece-static)
target_include_directories(drashti-translate SYSTEM PRIVATE
  ${SPM_SOURCE}/src
  ${SPM_SOURCE}/src/builtin_pb
  ${SPM_SOURCE}/third_party
  ${SPM_SOURCE}/third_party/protobuf-lite)
target_compile_definitions(drashti-translate PRIVATE _USE_INTERNAL_STRING_VIEW)
# Our own code's warnings are errors, as -Werror on a Mac (a22-review-mt A13); the libraries' headers are external,
# and quiet: their warnings are not ours to fix.
if(MSVC)
  target_compile_options(drashti-translate PRIVATE /W4 /WX /utf-8 /external:anglebrackets /external:W0)
endif()
