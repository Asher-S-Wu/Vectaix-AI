// [T-android-text-segmenter] JNI bridge to CppJieba for TextSegmenter's Chinese
// path. Loads the dictionary trie + HMM model once from a directory the Kotlin
// side extracted out of Assets (JNI can't read Assets by path), then serves
// exact-mode (`Cut`) and search-mode (`CutForSearch`) segmentation.
//
// We deliberately build DictTrie + HMMModel directly and share them between a
// MixSegment (exact) and a QuerySegment (search) instead of using the full
// cppjieba::Jieba facade — Jieba pulls in KeywordExtractor, which needs
// idf.utf8 + stop_words.utf8 (~6MB we don't ship). Segmentation only needs the
// dict + HMM model, so this keeps the shipped asset down to ~5.4MB.
//
// Thread-safety: a single global instance guarded by a std::mutex. All C++ is
// wrapped in try/catch so a load failure or a malformed input returns false /
// an empty array to Kotlin rather than crashing the app.

#include <jni.h>
#include <android/log.h>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include "cppjieba/DictTrie.hpp"
#include "cppjieba/HMMModel.hpp"
#include "cppjieba/MixSegment.hpp"
#include "cppjieba/PosTagger.hpp"
#include "cppjieba/QuerySegment.hpp"

#define LOG_TAG "JiebaJNI"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

namespace {

// Owns the loaded dictionaries and both segmenters. Constructed once, under the
// global mutex, on the first successful nativeInit call.
struct JiebaState {
    std::unique_ptr<cppjieba::DictTrie> dict;
    std::unique_ptr<cppjieba::HMMModel> hmm;
    std::unique_ptr<cppjieba::MixSegment> mixSeg;      // exact mode (Cut, HMM on)
    std::unique_ptr<cppjieba::QuerySegment> querySeg;  // search-engine mode
};

std::mutex g_mutex;
std::unique_ptr<JiebaState> g_state;

// Join two path components with a single '/'.
std::string joinPath(const std::string& dir, const std::string& file) {
    if (dir.empty()) return file;
    if (dir.back() == '/') return dir + file;
    return dir + "/" + file;
}

// Convert a jstring to a std::string (UTF-8). Returns "" on null.
std::string toStdString(JNIEnv* env, jstring s) {
    if (s == nullptr) return std::string();
    const char* chars = env->GetStringUTFChars(s, nullptr);
    if (chars == nullptr) return std::string();
    std::string out(chars);
    env->ReleaseStringUTFChars(s, chars);
    return out;
}

// Build a Java String[] from a vector of UTF-8 words.
jobjectArray toStringArray(JNIEnv* env, const std::vector<std::string>& words) {
    jclass stringClass = env->FindClass("java/lang/String");
    jobjectArray arr = env->NewObjectArray(static_cast<jsize>(words.size()), stringClass, nullptr);
    if (arr == nullptr) return nullptr;
    for (jsize i = 0; i < static_cast<jsize>(words.size()); ++i) {
        jstring w = env->NewStringUTF(words[i].c_str());
        env->SetObjectArrayElement(arr, i, w);
        env->DeleteLocalRef(w);
    }
    return arr;
}

// Empty String[0] — the failure / empty-input return value.
jobjectArray emptyStringArray(JNIEnv* env) {
    jclass stringClass = env->FindClass("java/lang/String");
    return env->NewObjectArray(0, stringClass, nullptr);
}

}  // namespace

extern "C" {

JNIEXPORT jboolean JNICALL
Java_com_openminis_app_shared_JiebaEngine_nativeInit(
    JNIEnv* env, jobject /* thiz */, jstring dictDir) {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (g_state) return JNI_TRUE;  // already initialized

    const std::string dir = toStdString(env, dictDir);
    if (dir.empty()) {
        LOGE("nativeInit: empty dict dir");
        return JNI_FALSE;
    }

    try {
        auto state = std::make_unique<JiebaState>();
        const std::string dictPath = joinPath(dir, "jieba.dict.utf8");
        const std::string hmmPath = joinPath(dir, "hmm_model.utf8");

        state->dict = std::make_unique<cppjieba::DictTrie>(dictPath);
        state->hmm = std::make_unique<cppjieba::HMMModel>(hmmPath);
        // Both segmenters borrow the same dict/HMM (non-owning pointers).
        state->mixSeg = std::make_unique<cppjieba::MixSegment>(state->dict.get(), state->hmm.get());
        state->querySeg = std::make_unique<cppjieba::QuerySegment>(state->dict.get(), state->hmm.get());

        g_state = std::move(state);
        LOGI("nativeInit: loaded dictionaries from %s", dir.c_str());
        return JNI_TRUE;
    } catch (const std::exception& e) {
        LOGE("nativeInit failed: %s", e.what());
        g_state.reset();
        return JNI_FALSE;
    } catch (...) {
        LOGE("nativeInit failed: unknown error");
        g_state.reset();
        return JNI_FALSE;
    }
}

JNIEXPORT jobjectArray JNICALL
Java_com_openminis_app_shared_JiebaEngine_nativeSegment(
    JNIEnv* env, jobject /* thiz */, jstring text) {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (!g_state) {
        LOGE("nativeSegment before init");
        return emptyStringArray(env);
    }
    try {
        const std::string sentence = toStdString(env, text);
        std::vector<std::string> words;
        // Exact mode with HMM enabled (recovers OOV words).
        g_state->mixSeg->Cut(sentence, words, /* hmm = */ true);
        return toStringArray(env, words);
    } catch (const std::exception& e) {
        LOGE("nativeSegment failed: %s", e.what());
        return emptyStringArray(env);
    } catch (...) {
        LOGE("nativeSegment failed: unknown error");
        return emptyStringArray(env);
    }
}

JNIEXPORT jobjectArray JNICALL
Java_com_openminis_app_shared_JiebaEngine_nativeSegmentForSearch(
    JNIEnv* env, jobject /* thiz */, jstring text) {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (!g_state) {
        LOGE("nativeSegmentForSearch before init");
        return emptyStringArray(env);
    }
    try {
        const std::string sentence = toStdString(env, text);
        std::vector<std::string> words;
        g_state->querySeg->Cut(sentence, words, /* hmm = */ true);
        return toStringArray(env, words);
    } catch (const std::exception& e) {
        LOGE("nativeSegmentForSearch failed: %s", e.what());
        return emptyStringArray(env);
    } catch (...) {
        LOGE("nativeSegmentForSearch failed: unknown error");
        return emptyStringArray(env);
    }
}

// [T-android-voice-correction] Part-of-speech tagging, needed by
// VocabularyFilter's admission scoring (proper-noun tags nr/ns/nz/nt earn +2).
//
// Returns a FLAT String[] of alternating token, tag, token, tag, … rather than
// an array of pairs: building a Pair[] here would mean FindClass +
// GetMethodID + NewObject per token across the JNI boundary, where the flat
// form is one NewStringUTF per element and a trivial pairwise walk in Kotlin.
//
// PosTagger is stateless and cheap to construct (its ctor is empty; it borrows
// the DictTrie from the SegmentTagged we hand it), so unlike KeywordExtractor
// it needs no extra dictionary files and is built per call rather than kept in
// JiebaState.
JNIEXPORT jobjectArray JNICALL
Java_com_openminis_app_shared_JiebaEngine_nativePosTag(
    JNIEnv* env, jobject /* thiz */, jstring text) {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (!g_state) {
        LOGE("nativePosTag before init");
        return emptyStringArray(env);
    }
    try {
        const std::string sentence = toStdString(env, text);
        std::vector<std::pair<std::string, std::string> > tagged;
        cppjieba::PosTagger tagger;
        // MixSegment is a SegmentTagged, so it supplies both the cut and the
        // DictTrie the tag lookup needs.
        tagger.Tag(sentence, tagged, *g_state->mixSeg);
        std::vector<std::string> flat;
        flat.reserve(tagged.size() * 2);
        for (size_t i = 0; i < tagged.size(); ++i) {
            flat.push_back(tagged[i].first);
            flat.push_back(tagged[i].second);
        }
        return toStringArray(env, flat);
    } catch (const std::exception& e) {
        LOGE("nativePosTag failed: %s", e.what());
        return emptyStringArray(env);
    } catch (...) {
        LOGE("nativePosTag failed: unknown error");
        return emptyStringArray(env);
    }
}

}  // extern "C"
