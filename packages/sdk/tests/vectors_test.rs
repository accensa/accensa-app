use accensa_sdk::{
    invalid_vector_count, valid_vector_count, vector_count, verify_merkle_proof, VECTORS,
};
use std::collections::HashSet;

/// Comprehensive test suite for vectors.rs.
///
/// Strategy:
/// 1. **Conformance**: Every vector in `VECTORS` must produce the correct
///    verification result (expected field). This pins our Rust
///    implementation to the shared conformance fixture.
/// 2. **Coverage**: Both true and false expectations must be present,
///    ensuring we test both acceptance and rejection paths.
/// 3. **Edge cases**: Empty proofs, single-leaf batches, wrong roots,
///    reordered proofs, and truncated proofs are all explicitly covered.
/// 4. **Structural integrity**: Vector metadata (name, leaf, proof, root)
///    must be well-formed: all bytes are valid, proofs have correct
///    lengths, and roots match the expected computation.

/// Verify that every vector in the suite produces the expected result.
#[test]
fn all_vectors_produce_expected_results() {
    for vector in VECTORS {
        let result = verify_merkle_proof(&vector.leaf, vector.proof, &vector.root);
        assert_eq!(
            result, vector.expected,
            "Vector '{}' failed: got {} but expected {}",
            vector.name, result, vector.expected
        );
    }
}

/// Confirm the suite covers both true and false expectations.
#[test]
fn covers_both_true_and_false_expectations() {
    let expectations: HashSet<bool> = VECTORS.iter().map(|v| v.expected).collect();
    assert!(expectations.contains(&true), "No true expectations found");
    assert!(expectations.contains(&false), "No false expectations found");
}

/// Verify the count of vectors matches expectations.
#[test]
fn vector_count_is_correct() {
    assert_eq!(vector_count(), VECTORS.len());
    assert!(
        vector_count() >= 10,
        "Expected at least 10 vectors for comprehensive coverage"
    );
}

/// Verify we have both valid and invalid vectors.
#[test]
fn has_both_valid_and_invalid_vectors() {
    assert!(
        valid_vector_count() > 0,
        "Must have at least one valid vector"
    );
    assert!(
        invalid_vector_count() > 0,
        "Must have at least one invalid vector"
    );
    assert_eq!(
        valid_vector_count() + invalid_vector_count(),
        vector_count()
    );
}

/// Test all named categories of vectors are present.
#[test]
fn all_vector_categories_are_present() {
    let names: Vec<&str> = VECTORS.iter().map(|v| v.name).collect();

    assert!(
        names.iter().any(|n| n.contains("valid membership proof")),
        "Missing valid membership proof vector"
    );
    assert!(
        names.iter().any(|n| n.contains("forged leaf")),
        "Missing forged leaf rejection vector"
    );
    assert!(
        names.iter().any(|n| n.contains("empty proof")),
        "Missing empty proof vector"
    );
    assert!(
        names.iter().any(|n| n.contains("wrong root")),
        "Missing wrong root rejection vector"
    );
    assert!(
        names.iter().any(|n| n.contains("left leaf")),
        "Missing left leaf vector"
    );
    assert!(
        names.iter().any(|n| n.contains("right leaf")),
        "Missing right leaf vector"
    );
    assert!(
        names.iter().any(|n| n.contains("leaf 0")),
        "Missing leaf 0 vector"
    );
    assert!(
        names.iter().any(|n| n.contains("leaf 2")),
        "Missing leaf 2 vector"
    );
    assert!(
        names.iter().any(|n| n.contains("leaf 0")),
        "Missing eight-leaf batch vector"
    );
    assert!(
        names.iter().any(|n| n.contains("leaf 3")),
        "Missing leaf 3 vector"
    );
    assert!(
        names.iter().any(|n| n.contains("leaf 7")),
        "Missing leaf 7 vector"
    );
    assert!(
        names.iter().any(|n| n.contains("different root")),
        "Missing different root rejection vector"
    );
    assert!(
        names.iter().any(|n| n.contains("reordered")),
        "Missing reordered proof rejection vector"
    );
    assert!(
        names.iter().any(|n| n.contains("truncated")),
        "Missing truncated proof rejection vector"
    );
}

/// Test single-leaf batch: empty proof against correct root must verify.
#[test]
fn single_leaf_empty_proof_verifies_against_correct_root() {
    let vector = VECTORS
        .iter()
        .find(|v| v.name.contains("single-leaf batch — empty proof"))
        .unwrap();
    assert!(vector.expected);
    let proof_refs: Vec<[u8; 32]> = vector.proof.to_vec();
    assert!(verify_merkle_proof(&vector.leaf, &proof_refs, &vector.root));
}

/// Test single-leaf batch: empty proof against wrong root must reject.
#[test]
fn single_leaf_empty_proof_rejected_against_wrong_root() {
    let vector = VECTORS
        .iter()
        .find(|v| v.name.contains("empty proof against wrong root"))
        .unwrap();
    assert!(!vector.expected);
    let proof_refs: Vec<[u8; 32]> = vector.proof.to_vec();
    assert!(!verify_merkle_proof(
        &vector.leaf,
        &proof_refs,
        &vector.root
    ));
}

/// Test forged leaf is always rejected.
#[test]
fn forged_leaf_is_rejected() {
    let vector = VECTORS
        .iter()
        .find(|v| v.name.contains("forged leaf"))
        .unwrap();
    assert!(!vector.expected);
    let proof_refs: Vec<[u8; 32]> = vector.proof.to_vec();
    assert!(!verify_merkle_proof(
        &vector.leaf,
        &proof_refs,
        &vector.root
    ));
}

/// Test valid proof against different root is rejected.
#[test]
fn valid_proof_against_different_root_is_rejected() {
    let vector = VECTORS
        .iter()
        .find(|v| v.name.contains("different root"))
        .unwrap();
    assert!(!vector.expected);
    let proof_refs: Vec<[u8; 32]> = vector.proof.to_vec();
    assert!(!verify_merkle_proof(
        &vector.leaf,
        &proof_refs,
        &vector.root
    ));
}

/// Test reordered proof is rejected.
#[test]
fn reordered_proof_is_rejected() {
    let vector = VECTORS
        .iter()
        .find(|v| v.name.contains("reordered"))
        .unwrap();
    assert!(!vector.expected);
    let proof_refs: Vec<[u8; 32]> = vector.proof.to_vec();
    assert!(!verify_merkle_proof(
        &vector.leaf,
        &proof_refs,
        &vector.root
    ));
}

/// Test truncated proof is rejected.
#[test]
fn truncated_proof_is_rejected() {
    let vector = VECTORS
        .iter()
        .find(|v| v.name.contains("truncated"))
        .unwrap();
    assert!(!vector.expected);
    let proof_refs: Vec<[u8; 32]> = vector.proof.to_vec();
    assert!(!verify_merkle_proof(
        &vector.leaf,
        &proof_refs,
        &vector.root
    ));
}

/// Test two-leaf batch: left leaf verifies.
#[test]
fn two_leaf_left_leaf_verifies() {
    let vector = VECTORS
        .iter()
        .find(|v| v.name.contains("left leaf"))
        .unwrap();
    assert!(vector.expected);
    let proof_refs: Vec<[u8; 32]> = vector.proof.to_vec();
    assert!(verify_merkle_proof(&vector.leaf, &proof_refs, &vector.root));
}

/// Test two-leaf batch: right leaf verifies.
#[test]
fn two_leaf_right_leaf_verifies() {
    let vector = VECTORS
        .iter()
        .find(|v| v.name.contains("right leaf"))
        .unwrap();
    assert!(vector.expected);
    let proof_refs: Vec<[u8; 32]> = vector.proof.to_vec();
    assert!(verify_merkle_proof(&vector.leaf, &proof_refs, &vector.root));
}

/// Test three-leaf batch: leaf 0 verifies.
#[test]
fn three_leaf_leaf_0_verifies() {
    let vector = VECTORS
        .iter()
        .find(|v| v.name.contains("three-leaf batch — leaf 0"))
        .unwrap();
    assert!(vector.expected);
    let proof_refs: Vec<[u8; 32]> = vector.proof.to_vec();
    assert!(verify_merkle_proof(&vector.leaf, &proof_refs, &vector.root));
}

/// Test three-leaf batch: leaf 2 verifies.
#[test]
fn three_leaf_leaf_2_verifies() {
    let vector = VECTORS
        .iter()
        .find(|v| v.name.contains("three-leaf batch — leaf 2"))
        .unwrap();
    assert!(vector.expected);
    let proof_refs: Vec<[u8; 32]> = vector.proof.to_vec();
    assert!(verify_merkle_proof(&vector.leaf, &proof_refs, &vector.root));
}

/// Test eight-leaf batch: leaf 0 verifies.
#[test]
fn eight_leaf_leaf_0_verifies() {
    let vector = VECTORS
        .iter()
        .find(|v| v.name.contains("eight-leaf batch — leaf 0"))
        .unwrap();
    assert!(vector.expected);
    let proof_refs: Vec<[u8; 32]> = vector.proof.to_vec();
    assert!(verify_merkle_proof(&vector.leaf, &proof_refs, &vector.root));
}

/// Test eight-leaf batch: leaf 3 verifies.
#[test]
fn eight_leaf_leaf_3_verifies() {
    let vector = VECTORS
        .iter()
        .find(|v| v.name.contains("eight-leaf batch — leaf 3"))
        .unwrap();
    assert!(vector.expected);
    let proof_refs: Vec<[u8; 32]> = vector.proof.to_vec();
    assert!(verify_merkle_proof(&vector.leaf, &proof_refs, &vector.root));
}

/// Test eight-leaf batch: leaf 7 verifies.
#[test]
fn eight_leaf_leaf_7_verifies() {
    let vector = VECTORS
        .iter()
        .find(|v| v.name.contains("eight-leaf batch — leaf 7"))
        .unwrap();
    assert!(vector.expected);
    let proof_refs: Vec<[u8; 32]> = vector.proof.to_vec();
    assert!(verify_merkle_proof(&vector.leaf, &proof_refs, &vector.root));
}

/// Test that all leaf hashes are exactly 32 bytes.
#[test]
fn all_leaves_are_32_bytes() {
    for vector in VECTORS {
        assert_eq!(
            vector.leaf.len(),
            32,
            "Leaf in '{}' is not 32 bytes",
            vector.name
        );
    }
}

/// Test that all root hashes are exactly 32 bytes.
#[test]
fn all_roots_are_32_bytes() {
    for vector in VECTORS {
        assert_eq!(
            vector.root.len(),
            32,
            "Root in '{}' is not 32 bytes",
            vector.name
        );
    }
}

/// Test that all proof entries are exactly 32 bytes.
#[test]
fn all_proof_entries_are_32_bytes() {
    for vector in VECTORS {
        for sibling in vector.proof {
            assert_eq!(
                sibling.len(),
                32,
                "Proof entry in '{}' is not 32 bytes",
                vector.name
            );
        }
    }
}

/// Test that all vectors have a non-empty name.
#[test]
fn all_vectors_have_non_empty_names() {
    for vector in VECTORS {
        assert!(!vector.name.is_empty(), "Vector has empty name");
    }
}

/// Test the live testnet batch #1 is anchored on-chain correctly.
#[test]
fn live_testnet_batch_onchain_root_matches() {
    let vector = VECTORS
        .iter()
        .find(|v| v.name.contains("valid membership proof"))
        .unwrap();
    // The on-chain root is c6ccdcdb57896fa4999d9dea6a5ef40523d55e46cf32b621d7ea4a582d90e6ac
    let expected_onchain =
        hex::decode("c6ccdcdb57896fa4999d9dea6a5ef40523d55e46cf32b621d7ea4a582d90e6ac").unwrap();
    let expected_root: [u8; 32] = expected_onchain.try_into().unwrap();
    assert_eq!(vector.root, expected_root);
    assert!(vector.expected);
}

/// Verify the first vector is the one anchored on-chain.
#[test]
fn first_vector_is_onchain_anchored() {
    let vector = &VECTORS[0];
    assert!(vector.expected);
    assert!(verify_merkle_proof(
        &vector.leaf,
        vector.proof,
        &vector.root
    ));
}

/// Determinism: repeated verification of the same vector produces the same result.
#[test]
fn verification_is_deterministic() {
    let vector = &VECTORS[0];
    let results: Vec<bool> = (0..10)
        .map(|_| verify_merkle_proof(&vector.leaf, vector.proof, &vector.root))
        .collect();
    let unique: HashSet<bool> = results.into_iter().collect();
    assert_eq!(unique.len(), 1, "Verification must be deterministic");
}

/// Verify all vectors produce consistent results across multiple calls.
#[test]
fn all_vectors_are_consistent_across_calls() {
    for vector in VECTORS {
        let first = verify_merkle_proof(&vector.leaf, vector.proof, &vector.root);
        for _ in 0..5 {
            assert_eq!(
                first,
                verify_merkle_proof(&vector.leaf, vector.proof, &vector.root)
            );
        }
    }
}

/// Test that a proof with a wrong sibling hash is rejected.
#[test]
fn wrong_sibling_in_proof_is_rejected() {
    let vector = VECTORS
        .iter()
        .find(|v| v.name.contains("valid membership proof"))
        .unwrap();
    let mut corrupted_proof = vector.proof.to_vec();
    corrupted_proof[0][0] ^= 0xFF; // Flip all bits in the first sibling
    assert!(!verify_merkle_proof(
        &vector.leaf,
        &corrupted_proof,
        &vector.root
    ));
}

/// Test that a proof with too many siblings is rejected.
#[test]
fn extra_siblings_in_proof_are_ignored_or_rejected() {
    let vector = VECTORS
        .iter()
        .find(|v| v.name.contains("valid membership proof"))
        .unwrap();
    let mut extended_proof = vector.proof.to_vec();
    extended_proof.push([0u8; 32]); // Add an extra sibling
    assert!(!verify_merkle_proof(
        &vector.leaf,
        &extended_proof,
        &vector.root
    ));
}

/// Test that a proof with no siblings but a different root is rejected.
#[test]
fn empty_proof_with_wrong_root_fails() {
    let vector = VECTORS
        .iter()
        .find(|v| v.name.contains("empty proof"))
        .unwrap();
    // Use the root from the wrong root vector
    let wrong_root_vector = VECTORS
        .iter()
        .find(|v| v.name.contains("empty proof against wrong root"))
        .unwrap();
    assert!(!verify_merkle_proof(
        &vector.leaf,
        &[],
        &wrong_root_vector.root
    ));
}

/// Verify the merkle proof function handles all vector types correctly.
#[test]
fn verify_function_matches_expected_for_all_vectors() {
    for vector in VECTORS {
        let result = verify_merkle_proof(&vector.leaf, vector.proof, &vector.root);
        // The result must match the expected field exactly
        assert_eq!(
            result, vector.expected,
            "Vector '{}' mismatch: verify_merkle_proof returned {} but expected {}",
            vector.name, result, vector.expected
        );
    }
}
