def longest_substring_with_k_distinct(s: str, k: int) -> int:
    if not s or k <= 0:
        return 0
        
    char_count = {}
    max_length = 0
    start = 0
    
    for end in range(len(s)):
        # Add current character to window
        char_count[s[end]] = char_count.get(s[end], 0) + 1
        
        # Shrink window while we have more than k distinct characters
        while len(char_count) > k:
            char_count[s[start]] -= 1
            if char_count[s[start]] == 0:
                del char_count[s[start]]
            start += 1
            
        # Update max_length if current window is longer
        curr_length = end - start
        max_length = max(max_length, curr_length)
    
    return max_length

if __name__ == "__main__":
    longest_substring_with_k_distinct("aaabaabaaa", 2)
